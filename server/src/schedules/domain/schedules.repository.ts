import type { NewSchedule, Schedule, SchedulePatch } from './schedule.js';

/**
 * One validity interval of a student in a schedule. Removing a student closes
 * `validTo` instead of deleting, so past intervals stay queryable.
 */
export interface ScheduleAssignment {
  id: string;
  scheduleId: string;
  studentId: string;
  validFrom: Date;
  /** Null while the student is still assigned. */
  validTo: Date | null;
}

export interface SchedulesRepository {
  create(data: NewSchedule): Promise<Schedule>;
  findById(id: string): Promise<Schedule | null>;
  findAll(): Promise<Schedule[]>;
  /** Recurring schedules of a period, ordered by weekday and start. */
  findByPeriod(periodId: string): Promise<Schedule[]>;
  /** Null when the schedule does not exist. */
  update(id: string, patch: SchedulePatch): Promise<Schedule | null>;
  /** Deletes the schedule, its assignments and occurrences; false if missing. */
  delete(id: string): Promise<boolean>;
  /** Schedules the student is assigned to at `at` (active intervals only). */
  findByStudent(studentId: string, at: Date): Promise<Schedule[]>;
  /**
   * Opens an interval starting at `at` unless one is already active.
   * Returns whether a new interval was created.
   */
  assignStudent(
    scheduleId: string,
    studentId: string,
    at: Date,
  ): Promise<boolean>;
  /**
   * Closes the active interval at `at`, without deleting it. Returns whether
   * there was an active interval.
   */
  unassignStudent(
    scheduleId: string,
    studentId: string,
    at: Date,
  ): Promise<boolean>;
  /** Student ids assigned at `at` per schedule, in one query. */
  listStudentIds(
    scheduleIds: string[],
    at: Date,
  ): Promise<Map<string, string[]>>;
  /** Every interval of a schedule, closed ones included, oldest first. */
  listAssignments(scheduleId: string): Promise<ScheduleAssignment[]>;
}

export const SCHEDULES_REPOSITORY = Symbol('SCHEDULES_REPOSITORY');
