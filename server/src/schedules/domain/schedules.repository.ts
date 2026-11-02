import type { NewSchedule, Schedule } from './schedule.js';

export interface SchedulesRepository {
  create(data: NewSchedule): Promise<Schedule>;
  findById(id: string): Promise<Schedule | null>;
  findAll(): Promise<Schedule[]>;
  findByStudent(studentId: string): Promise<Schedule[]>;
  /** Idempotent. */
  assignStudent(scheduleId: string, studentId: string): Promise<void>;
  /** Idempotent. */
  unassignStudent(scheduleId: string, studentId: string): Promise<void>;
  /** Assigned student ids per schedule, in one query. */
  listStudentIds(scheduleIds: string[]): Promise<Map<string, string[]>>;
}

export const SCHEDULES_REPOSITORY = Symbol('SCHEDULES_REPOSITORY');
