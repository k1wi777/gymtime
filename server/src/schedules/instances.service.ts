import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  fromBogota,
  toBogotaParts,
  weekdayOf,
} from '../common/time/bogota.js';
import { entryWindow, type EntryWindow } from './domain/entry-window.js';
import {
  INSTANCES_REPOSITORY,
  type InstancesRepository,
} from './domain/instances.repository.js';
import { MAX_ENTRY_MARGIN_MINUTES, type Schedule } from './domain/schedule.js';
import type {
  NewScheduleInstance,
  ScheduleInstance,
} from './domain/schedule-instance.js';
import {
  SCHEDULES_REPOSITORY,
  type SchedulesRepository,
} from './domain/schedules.repository.js';
import { SCHEDULES_CONFIG, type SchedulesConfig } from './schedules.config.js';

const MS_PER_MINUTE = 60_000;

export interface Occurrence {
  instance: ScheduleInstance;
  schedule: Schedule;
  window: EntryWindow;
}

export interface ResolvedOccurrence extends Occurrence {
  /** True while `at` is before the entry deadline. */
  entryOpen: boolean;
}

export interface RelevantOccurrence extends Occurrence {
  studentIds: string[];
}

@Injectable()
export class InstancesService {
  constructor(
    @Inject(SCHEDULES_REPOSITORY)
    private readonly schedules: SchedulesRepository,
    @Inject(INSTANCES_REPOSITORY)
    private readonly instances: InstancesRepository,
    @Inject(SCHEDULES_CONFIG) private readonly config: SchedulesConfig,
  ) {}

  /** Idempotent: today and the next days of every schedule; returns how many were created. */
  async ensureHorizon(now: Date): Promise<number> {
    return this.generate(await this.schedules.findAll(), now);
  }

  ensureForSchedule(schedule: Schedule, now: Date): Promise<number> {
    return this.generate([schedule], now);
  }

  /**
   * The occurrence that applies to a student at `at`: one with entry open
   * (the latest to start wins, so back-to-back schedules resolve to the next
   * one) or else one in progress (the earliest to start); null if none.
   */
  async resolveForStudent(
    studentId: string,
    at: Date,
  ): Promise<ResolvedOccurrence | null> {
    const schedules = await this.schedules.findByStudent(studentId);
    if (schedules.length === 0) return null;
    const reach = new Date(
      at.getTime() + MAX_ENTRY_MARGIN_MINUTES * MS_PER_MINUTE,
    );
    const found = await this.instances.findInRange(
      at,
      reach,
      schedules.map((s) => s.id),
    );
    const byId = new Map(schedules.map((s) => [s.id, s]));
    const candidates = found
      .map((instance) =>
        this.occurrence(instance, byId.get(instance.scheduleId)),
      )
      .filter(
        (o): o is Occurrence =>
          o !== null && o.window.opensAt <= at && at < o.instance.endsAt,
      )
      .map((o) => ({ ...o, entryOpen: at < o.window.closesAt }));

    const open = candidates.filter((c) => c.entryOpen);
    if (open.length > 0) return open[open.length - 1];
    return candidates[0] ?? null;
  }

  /**
   * Occurrences in progress or starting within `leadMin` minutes, with their
   * assigned students, ordered by start. One query for students (no N+1).
   */
  async listRelevant(
    now: Date,
    leadMin: number,
  ): Promise<RelevantOccurrence[]> {
    const lead = leadMin * MS_PER_MINUTE;
    const reach = new Date(now.getTime() + lead);
    const found = (await this.instances.findInRange(now, reach)).filter(
      (i) => i.endsAt > now,
    );
    return this.withStudents(found);
  }

  /** Upcoming occurrences (not yet ended) of the given schedules, grouped by schedule. */
  async listUpcoming(
    scheduleIds: string[],
    now: Date,
  ): Promise<Map<string, ScheduleInstance[]>> {
    const result = new Map<string, ScheduleInstance[]>(
      scheduleIds.map((id) => [id, []]),
    );
    if (scheduleIds.length === 0) return result;
    const horizon = fromBogota(
      addDays(toBogotaParts(now).date, this.config.instanceHorizonDays + 1),
      '00:00',
    );
    const found = await this.instances.findInRange(now, horizon, scheduleIds);
    for (const instance of found) {
      if (instance.endsAt > now)
        result.get(instance.scheduleId)?.push(instance);
    }
    return result;
  }

  /** Instances starting or ending in (from, to], used by the sync scheduler. */
  async listWithEdgesBetween(
    from: Date,
    to: Date,
    leadMin: number,
  ): Promise<{ starting: ScheduleInstance[]; ended: ScheduleInstance[] }> {
    const lead = leadMin * MS_PER_MINUTE;
    const found = await this.instances.findInRange(
      from,
      new Date(to.getTime() + lead),
    );
    const within = (t: number) => t > from.getTime() && t <= to.getTime();
    return {
      starting: found.filter((i) => within(i.startsAt.getTime() - lead)),
      ended: found.filter((i) => within(i.endsAt.getTime())),
    };
  }

  private async withStudents(
    found: ScheduleInstance[],
  ): Promise<RelevantOccurrence[]> {
    if (found.length === 0) return [];
    const scheduleIds = [...new Set(found.map((i) => i.scheduleId))];
    const [schedules, students] = await Promise.all([
      Promise.all(scheduleIds.map((id) => this.schedules.findById(id))),
      this.schedules.listStudentIds(scheduleIds),
    ]);
    const byId = new Map(
      schedules.flatMap((s) => (s ? [[s.id, s] as const] : [])),
    );
    return found.flatMap((instance) => {
      const occurrence = this.occurrence(
        instance,
        byId.get(instance.scheduleId),
      );
      return occurrence
        ? [
            {
              ...occurrence,
              studentIds: students.get(instance.scheduleId) ?? [],
            },
          ]
        : [];
    });
  }

  private occurrence(
    instance: ScheduleInstance,
    schedule: Schedule | undefined,
  ): Occurrence | null {
    if (!schedule) return null;
    const window = entryWindow(instance, schedule, {
      openMinutes: this.config.entryOpenMinutes,
      closeMinutes: this.config.entryCloseMinutes,
    });
    return { instance, schedule, window };
  }

  private generate(schedules: Schedule[], now: Date): Promise<number> {
    const today = toBogotaParts(now).date;
    const items: NewScheduleInstance[] = [];
    for (let offset = 0; offset <= this.config.instanceHorizonDays; offset++) {
      const date = addDays(today, offset);
      for (const schedule of schedules) {
        if (!occursOn(schedule, date)) continue;
        items.push({
          scheduleId: schedule.id,
          date,
          startsAt: fromBogota(date, schedule.startTime),
          endsAt: fromBogota(date, schedule.endTime),
        });
      }
    }
    return this.instances.createMany(items);
  }
}

function occursOn(schedule: Schedule, date: string): boolean {
  return schedule.date !== null
    ? schedule.date === date
    : schedule.weekday === weekdayOf(date);
}
