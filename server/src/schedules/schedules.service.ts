import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { secondsOfDay, toBogotaParts } from '../common/time/bogota.js';
import type { Student } from '../students/domain/student.js';
import { StudentsService } from '../students/students.service.js';
import { InstancesService } from './instances.service.js';
import {
  MAX_ENTRY_MARGIN_MINUTES,
  ScheduleValidationError,
  type NewSchedule,
  type Schedule,
} from './domain/schedule.js';
import type { ScheduleInstance } from './domain/schedule-instance.js';
import {
  SCHEDULES_REPOSITORY,
  type SchedulesRepository,
} from './domain/schedules.repository.js';

export type CreateScheduleInput =
  | {
      name: string;
      weekday?: number | null;
      date?: string | null;
      start: string;
      end: string;
      entryOpenMinutes?: number | null;
      entryCloseMinutes?: number | null;
    }
  | { name: string; endsInMinutes: number };

export interface ScheduleDetail {
  schedule: Schedule;
  students: Student[];
  upcoming: ScheduleInstance[];
}

export type ScheduleLookupError = 'SCHEDULE_NOT_FOUND' | 'STUDENT_NOT_FOUND';

export class ScheduleLookupFailed extends Error {
  constructor(readonly code: ScheduleLookupError) {
    super(
      code === 'SCHEDULE_NOT_FOUND'
        ? 'Schedule not found'
        : 'Student not found',
    );
  }
}

@Injectable()
export class SchedulesService {
  constructor(
    @Inject(SCHEDULES_REPOSITORY)
    private readonly repository: SchedulesRepository,
    private readonly students: StudentsService,
    private readonly instances: InstancesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** @throws ScheduleValidationError on an inconsistent definition. */
  async create(input: CreateScheduleInput): Promise<ScheduleDetail> {
    const data =
      'endsInMinutes' in input
        ? this.quickSchedule(input.name, input.endsInMinutes)
        : normalize(input);
    validate(data);
    const schedule = await this.repository.create(data);
    await this.instances.ensureForSchedule(schedule, this.clock.now());
    return this.detail(schedule);
  }

  async get(id: string): Promise<ScheduleDetail | null> {
    const schedule = await this.repository.findById(id);
    return schedule ? this.detail(schedule) : null;
  }

  async list(): Promise<ScheduleDetail[]> {
    const schedules = await this.repository.findAll();
    const ids = schedules.map((s) => s.id);
    const [studentIds, upcoming] = await Promise.all([
      this.repository.listStudentIds(ids),
      this.instances.listUpcoming(ids, this.clock.now()),
    ]);
    const all = await this.students.findByIds([
      ...new Set([...studentIds.values()].flat()),
    ]);
    const byId = new Map(all.map((s) => [s.id, s]));
    return schedules.map((schedule) => ({
      schedule,
      students: pick(studentIds.get(schedule.id), byId),
      upcoming: upcoming.get(schedule.id) ?? [],
    }));
  }

  /** Idempotent. @throws ScheduleLookupFailed when the schedule or student is missing. */
  async assignStudent(scheduleId: string, studentId: string): Promise<void> {
    await this.requireBoth(scheduleId, studentId);
    await this.repository.assignStudent(scheduleId, studentId);
  }

  /** Idempotent. @throws ScheduleLookupFailed when the schedule or student is missing. */
  async unassignStudent(scheduleId: string, studentId: string): Promise<void> {
    await this.requireBoth(scheduleId, studentId);
    await this.repository.unassignStudent(scheduleId, studentId);
  }

  /** Today's schedule starting now and ending `minutes` later (for quick tests). */
  private quickSchedule(name: string, minutes: number): NewSchedule {
    const now = this.clock.now();
    const start = new Date(Math.floor(now.getTime() / 1000) * 1000);
    const end = new Date(start.getTime() + minutes * 60_000);
    const from = toBogotaParts(start);
    const to = toBogotaParts(end);
    if (from.date !== to.date) {
      throw new ScheduleValidationError(
        'the schedule would end on another day; a schedule cannot cross midnight',
      );
    }
    return {
      name,
      weekday: null,
      date: from.date,
      startTime: from.time,
      endTime: to.time,
      entryOpenMinutes: null,
      // A test window must accept entries until the end, whatever its length.
      entryCloseMinutes: 0,
    };
  }

  private async requireBoth(scheduleId: string, studentId: string) {
    if (!(await this.repository.findById(scheduleId))) {
      throw new ScheduleLookupFailed('SCHEDULE_NOT_FOUND');
    }
    if ((await this.students.findById(studentId)) === null) {
      throw new ScheduleLookupFailed('STUDENT_NOT_FOUND');
    }
  }

  private async detail(schedule: Schedule): Promise<ScheduleDetail> {
    const [ids, upcoming] = await Promise.all([
      this.repository.listStudentIds([schedule.id]),
      this.instances.listUpcoming([schedule.id], this.clock.now()),
    ]);
    const students = await this.students.findByIds(ids.get(schedule.id) ?? []);
    return {
      schedule,
      students: students.sort((a, b) => a.name.localeCompare(b.name)),
      upcoming: upcoming.get(schedule.id) ?? [],
    };
  }
}

function pick(ids: string[] | undefined, byId: Map<string, Student>) {
  return (ids ?? [])
    .flatMap((id) => byId.get(id) ?? [])
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalize(
  input: Exclude<CreateScheduleInput, { endsInMinutes: number }>,
): NewSchedule {
  return {
    name: input.name,
    weekday: input.weekday ?? null,
    date: input.date ?? null,
    startTime: toSeconds(input.start),
    endTime: toSeconds(input.end),
    entryOpenMinutes: input.entryOpenMinutes ?? null,
    entryCloseMinutes: input.entryCloseMinutes ?? null,
  };
}

const toSeconds = (time: string) => (time.length === 5 ? `${time}:00` : time);

function validate(data: NewSchedule): void {
  if ((data.weekday === null) === (data.date === null)) {
    throw new ScheduleValidationError(
      'exactly one of weekday or date is required',
    );
  }
  if (data.weekday !== null && !(data.weekday >= 1 && data.weekday <= 7)) {
    throw new ScheduleValidationError('weekday must be between 1 and 7');
  }
  if (secondsOfDay(data.endTime) <= secondsOfDay(data.startTime)) {
    throw new ScheduleValidationError('end must be later than start');
  }
  for (const margin of [data.entryOpenMinutes, data.entryCloseMinutes]) {
    if (
      margin !== null &&
      !(margin >= 0 && margin <= MAX_ENTRY_MARGIN_MINUTES)
    ) {
      throw new ScheduleValidationError(
        `entry margins must be between 0 and ${MAX_ENTRY_MARGIN_MINUTES} minutes`,
      );
    }
  }
}
