import { Inject, Injectable } from '@nestjs/common';
import { EventLogService } from '../common/audit/event-log.service.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { secondsOfDay, toBogotaParts } from '../common/time/bogota.js';
import type { Student } from '../students/domain/student.js';
import { StudentsService } from '../students/students.service.js';
import { KeyedMutex } from '../common/concurrency/keyed-mutex.js';
import {
  InstancesService,
  type RegenerationResult,
} from './instances.service.js';
import {
  MAX_ENTRY_MARGIN_MINUTES,
  ScheduleHasAttendanceError,
  ScheduleOverlapError,
  ScheduleValidationError,
  timesOverlap,
  type NewSchedule,
  type Schedule,
  type SchedulePatch,
} from './domain/schedule.js';
import { PeriodError } from './periods/period.js';
import {
  PERIODS_REPOSITORY,
  type PeriodsRepository,
} from './periods/periods.repository.js';
import type { ScheduleInstance } from './domain/schedule-instance.js';
import {
  SCHEDULES_REPOSITORY,
  type ScheduleAssignment,
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
      /** Required by the API for recurring schedules, forbidden for one-off ones. */
      periodId?: string | null;
    }
  | { name: string; endsInMinutes: number };

/** `start`/`end` are `HH:mm[:ss]`; the margins may be null to use the defaults. */
export interface UpdateScheduleInput {
  name?: string;
  weekday?: number;
  start?: string;
  end?: string;
  entryOpenMinutes?: number | null;
  entryCloseMinutes?: number | null;
}

export interface ScheduleDetail {
  schedule: Schedule;
  students: Student[];
  upcoming: ScheduleInstance[];
  /** Present when the call (re)generated occurrences. */
  regeneration?: RegenerationResult;
}

export interface BulkAssignResult {
  assigned: Student[];
  alreadyAssigned: Student[];
  /** Existing but deactivated students. */
  inactive: Student[];
  /** Documents that match no student. */
  notFound: string[];
}

export interface CopyResult {
  assigned: number;
  alreadyAssigned: number;
  /** Students of the source that are deactivated and were not copied. */
  skippedInactive: number;
}

/** `validFrom` of an assignment lies in the past. */
const PAST_TOLERANCE_MS = 60_000;

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
    private readonly eventLog: EventLogService,
    @Inject(PERIODS_REPOSITORY) private readonly periods: PeriodsRepository,
  ) {}

  // Overlap check and write of the schedules of a period must not interleave.
  private readonly lock = new KeyedMutex();

  /**
   * @throws ScheduleValidationError on an inconsistent definition.
   * @throws ScheduleOverlapError when it overlaps another schedule of the period.
   * @throws PeriodError when the period does not exist.
   */
  async create(input: CreateScheduleInput): Promise<ScheduleDetail> {
    const data =
      'endsInMinutes' in input
        ? this.quickSchedule(input.name, input.endsInMinutes)
        : normalize(input);
    validate(data);
    return this.lock.run(data.periodId ?? 'no-period', async () => {
      await this.checkPeriodAndOverlap(data);
      const schedule = await this.repository.create(data);
      const regeneration =
        schedule.periodId !== null
          ? await this.regenerate([schedule.id])
          : undefined;
      if (regeneration === undefined) {
        await this.instances.ensureForSchedule(schedule, this.clock.now());
      }
      await this.eventLog.record('schedule.created', {
        scheduleId: schedule.id,
        kind: schedule.weekday !== null ? 'recurring' : 'one-off',
        periodId: schedule.periodId,
      });
      return { ...(await this.detail(schedule)), regeneration };
    });
  }

  /**
   * Edits a schedule and regenerates its future occurrences without history.
   * @throws ScheduleValidationError, ScheduleOverlapError
   * @throws ScheduleLookupFailed when the schedule does not exist.
   */
  async update(
    id: string,
    input: UpdateScheduleInput,
  ): Promise<ScheduleDetail> {
    const current = await this.repository.findById(id);
    if (!current) throw new ScheduleLookupFailed('SCHEDULE_NOT_FOUND');
    const patch = toPatch(input);
    if (patch.weekday !== undefined && current.weekday === null) {
      throw new ScheduleValidationError(
        'the weekday of a one-off schedule cannot be changed',
      );
    }
    const merged: NewSchedule = { ...current, ...patch };
    validate(merged);
    return this.lock.run(current.periodId ?? 'no-period', async () => {
      await this.checkPeriodAndOverlap(merged, id);
      const schedule = await this.repository.update(id, patch);
      if (!schedule) throw new ScheduleLookupFailed('SCHEDULE_NOT_FOUND');
      await this.eventLog.record('schedule.updated', {
        scheduleId: id,
        fields: Object.keys(input),
      });
      const regeneration = await this.regenerate([id]);
      return { ...(await this.detail(schedule)), regeneration };
    });
  }

  /**
   * Deletes a schedule with its assignments and occurrences.
   * @throws ScheduleHasAttendanceError when any occurrence has attendance or alarms.
   * @throws ScheduleLookupFailed when the schedule does not exist.
   */
  async remove(id: string): Promise<void> {
    if (!(await this.repository.findById(id))) {
      throw new ScheduleLookupFailed('SCHEDULE_NOT_FOUND');
    }
    if (await this.instances.scheduleHasHistory(id)) {
      throw new ScheduleHasAttendanceError();
    }
    await this.repository.delete(id);
    await this.eventLog.record('schedule.deleted', { scheduleId: id });
  }

  /**
   * Regenerates the future occurrences of some schedules and audits the
   * outcome when anything changed.
   */
  async regenerate(scheduleIds: string[]): Promise<RegenerationResult> {
    const result = await this.instances.reconcile(
      scheduleIds,
      this.clock.now(),
    );
    if (result.created + result.deleted + result.updated + result.kept > 0) {
      await this.eventLog.record('schedule.occurrences_regenerated', {
        scheduleIds,
        ...result,
      });
    }
    return result;
  }

  /** Schedules by id (names for history views); unknown ids are skipped. */
  async findByIds(ids: string[]): Promise<Schedule[]> {
    const wanted = new Set(ids);
    return (await this.repository.findAll()).filter((s) => wanted.has(s.id));
  }

  /** Recurring schedules of a period, for the weekly view. */
  listByPeriod(periodId: string): Promise<Schedule[]> {
    return this.repository.findByPeriod(periodId);
  }

  /** Student ids with a current assignment, per schedule, in one query. */
  currentStudentIds(scheduleIds: string[]): Promise<Map<string, string[]>> {
    return this.repository.listStudentIds(scheduleIds, this.clock.now());
  }

  private async checkPeriodAndOverlap(
    data: NewSchedule,
    ownId?: string,
  ): Promise<void> {
    if (data.periodId === null) return;
    if (!(await this.periods.findById(data.periodId))) {
      throw new PeriodError('PERIOD_NOT_FOUND', 'El periodo no existe');
    }
    if (data.weekday === null) return;
    // One reader: two schedules of the same period and day cannot overlap.
    const others = await this.repository.findByPeriod(data.periodId);
    const clash = others.find(
      (other) =>
        other.id !== ownId &&
        other.weekday === data.weekday &&
        timesOverlap(other, data),
    );
    if (clash) throw new ScheduleOverlapError(clash);
  }

  async get(id: string): Promise<ScheduleDetail | null> {
    const schedule = await this.repository.findById(id);
    return schedule ? this.detail(schedule) : null;
  }

  async list(): Promise<ScheduleDetail[]> {
    const schedules = await this.repository.findAll();
    const ids = schedules.map((s) => s.id);
    const now = this.clock.now();
    const [studentIds, upcoming] = await Promise.all([
      this.repository.listStudentIds(ids, now),
      this.instances.listUpcoming(ids, now),
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

  /**
   * Opens a validity interval starting at `validFrom` (default now); idempotent
   * while one is open.
   * @throws ScheduleLookupFailed when the schedule or student is missing.
   * @throws ScheduleValidationError when `validFrom` is in the past.
   */
  async assignStudent(
    scheduleId: string,
    studentId: string,
    validFrom?: Date,
  ): Promise<void> {
    await this.requireBoth(scheduleId, studentId);
    const now = this.clock.now();
    if (validFrom && validFrom.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
      throw new ScheduleValidationError('validFrom cannot be in the past');
    }
    const created = await this.repository.assignStudent(
      scheduleId,
      studentId,
      validFrom && validFrom > now ? validFrom : now,
    );
    if (created) {
      await this.eventLog.record('schedule.student_assigned', {
        scheduleId,
        studentId,
      });
    }
  }

  /**
   * Assigns the active students with these documents; the others are reported
   * apart, never aborting the call (E19-3).
   * @throws ScheduleLookupFailed when the schedule does not exist.
   */
  async bulkAssign(
    scheduleId: string,
    documents: string[],
  ): Promise<BulkAssignResult> {
    await this.requireSchedule(scheduleId);
    const wanted = [...new Set(documents.map((d) => d.trim()))].filter(
      (d) => d !== '',
    );
    const found = new Map(
      (await this.students.findByDocuments(wanted)).map((s) => [s.document, s]),
    );
    const result: BulkAssignResult = {
      assigned: [],
      alreadyAssigned: [],
      inactive: [],
      notFound: [],
    };
    const now = this.clock.now();
    for (const document of wanted) {
      const student = found.get(document);
      if (!student) result.notFound.push(document);
      else if (!student.active) result.inactive.push(student);
      else if (
        await this.repository.assignStudent(scheduleId, student.id, now)
      ) {
        result.assigned.push(student);
      } else result.alreadyAssigned.push(student);
    }
    // Counts only: documents are personal data.
    await this.eventLog.record('schedule.students_bulk_assigned', {
      scheduleId,
      assigned: result.assigned.length,
      alreadyAssigned: result.alreadyAssigned.length,
      inactive: result.inactive.length,
      notFound: result.notFound.length,
    });
    return result;
  }

  /**
   * Copies the current list of `fromId` into `toId`: only active students,
   * without duplicating those already there (E19-4).
   * @throws ScheduleLookupFailed when either schedule does not exist.
   * @throws ScheduleValidationError when both are the same schedule.
   */
  async copyStudents(toId: string, fromId: string): Promise<CopyResult> {
    if (toId === fromId) {
      throw new ScheduleValidationError('cannot copy a schedule onto itself');
    }
    await Promise.all([
      this.requireSchedule(toId),
      this.requireSchedule(fromId),
    ]);
    const now = this.clock.now();
    const ids = (await this.repository.listStudentIds([fromId], now)).get(
      fromId,
    );
    const students = await this.students.findByIds(ids ?? []);
    const result: CopyResult = {
      assigned: 0,
      alreadyAssigned: 0,
      skippedInactive: 0,
    };
    for (const student of students) {
      if (!student.active) result.skippedInactive++;
      else if (await this.repository.assignStudent(toId, student.id, now)) {
        result.assigned++;
      } else result.alreadyAssigned++;
    }
    await this.eventLog.record('schedule.students_copied', {
      scheduleId: toId,
      fromScheduleId: fromId,
      ...result,
    });
    return result;
  }

  /**
   * Closes the active interval now, keeping the row; idempotent.
   * @throws ScheduleLookupFailed when the schedule or student is missing.
   */
  async unassignStudent(scheduleId: string, studentId: string): Promise<void> {
    await this.requireBoth(scheduleId, studentId);
    const closed = await this.repository.unassignStudent(
      scheduleId,
      studentId,
      this.clock.now(),
    );
    if (closed) {
      await this.eventLog.record('schedule.student_unassigned', {
        scheduleId,
        studentId,
      });
    }
  }

  /** Every interval of a schedule, including the closed ones (history). */
  listAssignments(scheduleId: string): Promise<ScheduleAssignment[]> {
    return this.repository.listAssignments(scheduleId);
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
      periodId: null,
      // A test window must accept entries until the end, whatever its length.
      entryCloseMinutes: 0,
    };
  }

  private async requireSchedule(scheduleId: string): Promise<void> {
    if (!(await this.repository.findById(scheduleId))) {
      throw new ScheduleLookupFailed('SCHEDULE_NOT_FOUND');
    }
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
    const now = this.clock.now();
    const [ids, upcoming] = await Promise.all([
      this.repository.listStudentIds([schedule.id], now),
      this.instances.listUpcoming([schedule.id], now),
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
    periodId: input.periodId ?? null,
  };
}

function toPatch(input: UpdateScheduleInput): SchedulePatch {
  return {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.weekday !== undefined && { weekday: input.weekday }),
    ...(input.start !== undefined && { startTime: toSeconds(input.start) }),
    ...(input.end !== undefined && { endTime: toSeconds(input.end) }),
    ...(input.entryOpenMinutes !== undefined && {
      entryOpenMinutes: input.entryOpenMinutes,
    }),
    ...(input.entryCloseMinutes !== undefined && {
      entryCloseMinutes: input.entryCloseMinutes,
    }),
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
  if (data.periodId !== null && data.weekday === null) {
    throw new ScheduleValidationError(
      'a one-off schedule does not belong to a period',
    );
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
