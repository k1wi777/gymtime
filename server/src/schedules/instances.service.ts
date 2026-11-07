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
import { occurrenceDates } from './periods/occurrence-dates.js';
import type { Period, ServiceException } from './periods/period.js';
import {
  PERIODS_REPOSITORY,
  type PeriodsRepository,
} from './periods/periods.repository.js';
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

/** Outcome of regenerating occurrences (E18-4). */
export interface RegenerationResult {
  created: number;
  /** Future occurrences without history removed because they no longer apply. */
  deleted: number;
  /** Future occurrences moved because their schedule changed hours. */
  updated: number;
  /** Occurrences that should change but were kept: they have attendance, an alarm or already started. */
  kept: number;
}

/**
 * Tells which of these occurrence ids have history (attendance sessions,
 * alarms) and so must never be modified or deleted. Registered by the modules
 * that own that data; `schedules` does not know them.
 */
export type HistoryProbe = (instanceIds: string[]) => Promise<Iterable<string>>;

@Injectable()
export class InstancesService {
  constructor(
    @Inject(SCHEDULES_REPOSITORY)
    private readonly schedules: SchedulesRepository,
    @Inject(INSTANCES_REPOSITORY)
    private readonly instances: InstancesRepository,
    @Inject(SCHEDULES_CONFIG) private readonly config: SchedulesConfig,
    @Inject(PERIODS_REPOSITORY) private readonly periods: PeriodsRepository,
  ) {}

  private readonly historyProbes: HistoryProbe[] = [];

  /** Extension point: a module that stores history of occurrences registers here. */
  addHistoryProbe(probe: HistoryProbe): void {
    this.historyProbes.push(probe);
  }

  /** Occurrence ids (of these) that have attendance or alarms. */
  async withHistory(instanceIds: string[]): Promise<Set<string>> {
    if (instanceIds.length === 0) return new Set();
    const found = await Promise.all(
      this.historyProbes.map((probe) => probe(instanceIds)),
    );
    return new Set(found.flatMap((ids) => [...ids]));
  }

  /** Occurrences whose Bogota date is in [from, to], for the reports. */
  findByDates(
    from: string,
    to: string,
    scheduleIds?: string[],
  ): Promise<ScheduleInstance[]> {
    return this.instances.findByDates(from, to, scheduleIds);
  }

  /** Ids of every occurrence of a schedule, past and future (history filters). */
  async idsOfSchedule(scheduleId: string): Promise<string[]> {
    const all = await this.instances.findFromDate([scheduleId], '0000-01-01');
    return all.map((i) => i.id);
  }

  /** True when any occurrence of the schedule has attendance or alarms. */
  async scheduleHasHistory(scheduleId: string): Promise<boolean> {
    const all = await this.instances.findFromDate([scheduleId], '0000-01-01');
    return (await this.withHistory(all.map((i) => i.id))).size > 0;
  }

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
    const schedules = await this.schedules.findByStudent(studentId, at);
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
   * Occurrences whose entry window is open at `at` and that have not ended,
   * with their assigned students. This is what an attendance scan can act on.
   */
  async listActive(at: Date): Promise<RelevantOccurrence[]> {
    const reach = new Date(
      at.getTime() + MAX_ENTRY_MARGIN_MINUTES * MS_PER_MINUTE,
    );
    const found = await this.instances.findInRange(at, reach);
    const occurrences = await this.withStudents(found, at);
    return occurrences.filter(
      (o) => o.window.opensAt <= at && at < o.instance.endsAt,
    );
  }

  /**
   * The occurrence of the student's schedules, on the Bogota day of `at`, that
   * best matches that instant: the one in progress, else the one starting
   * nearest. Used to place an offline event a person approves; null when the
   * student had no schedule that day.
   */
  async findForStudentOnDay(
    studentId: string,
    at: Date,
  ): Promise<Occurrence | null> {
    const schedules = await this.schedules.findByStudent(studentId, at);
    if (schedules.length === 0) return null;
    const date = toBogotaParts(at).date;
    const from = fromBogota(date, '00:00');
    const to = new Date(fromBogota(addDays(date, 1), '00:00').getTime() - 1);
    const found = (
      await this.instances.findInRange(
        from,
        to,
        schedules.map((s) => s.id),
      )
    ).filter((instance) => instance.date === date);
    const byId = new Map(schedules.map((s) => [s.id, s]));
    const distance = (i: ScheduleInstance): number =>
      at >= i.startsAt && at <= i.endsAt
        ? 0
        : Math.min(
            Math.abs(at.getTime() - i.startsAt.getTime()),
            Math.abs(at.getTime() - i.endsAt.getTime()),
          );
    const best = [...found].sort(
      (a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id),
    )[0];
    return best ? this.occurrence(best, byId.get(best.scheduleId)) : null;
  }

  /** The occurrence of a schedule on a Bogota calendar date, or null. */
  async findOnDate(
    scheduleId: string,
    date: string,
  ): Promise<ScheduleInstance | null> {
    const from = fromBogota(date, '00:00');
    const to = new Date(fromBogota(addDays(date, 1), '00:00').getTime() - 1);
    const found = await this.instances.findInRange(from, to, [scheduleId]);
    return found.find((instance) => instance.date === date) ?? null;
  }

  /**
   * The occurrence a schedule would have on a future Bogota date even if it was
   * not generated yet (occurrences only exist a few days ahead). It is not
   * stored and has no id; null when the schedule does not occur that day.
   */
  projectOnDate(
    schedule: Schedule,
    date: string,
  ): Omit<ScheduleInstance, 'id'> | null {
    // A period's schedules are generated for the whole period, days without
    // service included: if the day is not stored, it does not occur.
    if (schedule.periodId !== null || !occursOn(schedule, date)) return null;
    return {
      scheduleId: schedule.id,
      date,
      startsAt: fromBogota(date, schedule.startTime),
      endsAt: fromBogota(date, schedule.endTime),
      status: 'scheduled',
    };
  }

  /** Occurrences by id with their schedule and entry window, keyed by instance id. */
  async getByIds(ids: string[]): Promise<Map<string, Occurrence>> {
    const result = new Map<string, Occurrence>();
    if (ids.length === 0) return result;
    const found = await this.instances.findByIds(ids);
    const scheduleIds = [...new Set(found.map((i) => i.scheduleId))];
    const schedules = await Promise.all(
      scheduleIds.map((id) => this.schedules.findById(id)),
    );
    const byId = new Map(
      schedules.flatMap((s) => (s ? [[s.id, s] as const] : [])),
    );
    for (const instance of found) {
      const occurrence = this.occurrence(
        instance,
        byId.get(instance.scheduleId),
      );
      if (occurrence) result.set(instance.id, occurrence);
    }
    return result;
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
    return this.withStudents(found, now);
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

  /** Only the assignments active at `at` count (R17). */
  private async withStudents(
    found: ScheduleInstance[],
    at: Date,
  ): Promise<RelevantOccurrence[]> {
    if (found.length === 0) return [];
    const scheduleIds = [...new Set(found.map((i) => i.scheduleId))];
    const [schedules, students] = await Promise.all([
      Promise.all(scheduleIds.map((id) => this.schedules.findById(id))),
      this.schedules.listStudentIds(scheduleIds, at),
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

  /**
   * Brings the future occurrences of these schedules in line with their
   * definition (E18-4): creates the missing ones, and removes or moves the
   * ones that no longer apply, but only while they are in the future and have
   * no attendance or alarm. Everything else is kept untouched.
   */
  async reconcile(
    scheduleIds: string[],
    now: Date,
  ): Promise<RegenerationResult> {
    const result: RegenerationResult = {
      created: 0,
      deleted: 0,
      updated: 0,
      kept: 0,
    };
    const schedules = (
      await Promise.all(scheduleIds.map((id) => this.schedules.findById(id)))
    ).flatMap((s) => (s ? [s] : []));
    if (schedules.length === 0) return result;
    const today = toBogotaParts(now).date;
    const context = await this.periodContext(schedules);
    const existing = await this.instances.findFromDate(
      schedules.map((s) => s.id),
      today,
    );
    const history = await this.withHistory(existing.map((i) => i.id));
    const toCreate: NewScheduleInstance[] = [];
    const toDelete: string[] = [];
    for (const schedule of schedules) {
      const { period, exceptions } = context(schedule);
      const to = schedule.date ?? period?.endDate ?? this.horizonEnd(today);
      const desired = new Map(
        occurrenceDates(schedule, period, exceptions, { from: today, to }).map(
          (date) => [date, this.draft(schedule, date)] as const,
        ),
      );
      const current = existing.filter((i) => i.scheduleId === schedule.id);
      for (const instance of current) {
        const wanted = desired.get(instance.date);
        const moved =
          wanted !== undefined &&
          (wanted.startsAt.getTime() !== instance.startsAt.getTime() ||
            wanted.endsAt.getTime() !== instance.endsAt.getTime());
        if (wanted !== undefined && !moved) continue;
        if (instance.startsAt <= now || history.has(instance.id)) {
          result.kept++;
        } else if (wanted === undefined) {
          toDelete.push(instance.id);
        } else {
          await this.instances.updateTimes(
            instance.id,
            wanted.startsAt,
            wanted.endsAt,
          );
          result.updated++;
        }
      }
      const have = new Set(current.map((i) => i.date));
      toCreate.push(
        ...[...desired.values()].filter((item) => !have.has(item.date)),
      );
    }
    const deleted = await this.instances.deleteByIds(toDelete);
    result.deleted = deleted;
    result.kept += toDelete.length - deleted;
    result.created = await this.instances.createMany(toCreate);
    return result;
  }

  private horizonEnd(today: string): string {
    return addDays(today, this.config.instanceHorizonDays);
  }

  private draft(schedule: Schedule, date: string): NewScheduleInstance {
    return {
      scheduleId: schedule.id,
      date,
      startsAt: fromBogota(date, schedule.startTime),
      endsAt: fromBogota(date, schedule.endTime),
    };
  }

  /** Resolves the period and days without service of each schedule in two queries. */
  private async periodContext(schedules: Schedule[]) {
    const ids = [
      ...new Set(schedules.flatMap((s) => (s.periodId ? [s.periodId] : []))),
    ];
    const [periods, exceptions] =
      ids.length === 0
        ? [[], new Map<string, ServiceException[]>()]
        : await Promise.all([
            this.periods.findAll(),
            this.periods.listExceptionsOf(ids),
          ]);
    const byId = new Map<string, Period>(periods.map((p) => [p.id, p]));
    return (schedule: Schedule) => {
      const period = schedule.periodId
        ? (byId.get(schedule.periodId) ?? null)
        : null;
      return {
        period,
        exceptions: period ? (exceptions.get(period.id) ?? []) : [],
      };
    };
  }

  /**
   * Creates missing occurrences; idempotent. The horizon (today and the next
   * days) is the safety net; with `wholePeriod` a period's schedules are
   * filled up to the end of the period.
   */
  private async generate(
    schedules: Schedule[],
    now: Date,
    wholePeriod = false,
  ): Promise<number> {
    const today = toBogotaParts(now).date;
    const context = await this.periodContext(schedules);
    const items = schedules.flatMap((schedule) => {
      const { period, exceptions } = context(schedule);
      const to = wholePeriod
        ? (period?.endDate ?? this.horizonEnd(today))
        : this.horizonEnd(today);
      return occurrenceDates(schedule, period, exceptions, {
        from: today,
        to,
      }).map((date) => this.draft(schedule, date));
    });
    return this.instances.createMany(items);
  }

  /**
   * Repairs the active period: every one of its schedules gets all its
   * missing occurrences. Returns how many were created.
   */
  async repairActivePeriod(now: Date): Promise<number> {
    const active = await this.periods.findActive();
    if (!active) return 0;
    const schedules = await this.schedules.findByPeriod(active.id);
    return this.generate(schedules, now, true);
  }
}

function occursOn(schedule: Schedule, date: string): boolean {
  return schedule.date !== null
    ? schedule.date === date
    : schedule.weekday === weekdayOf(date);
}
