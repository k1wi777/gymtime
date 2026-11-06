import type {
  NewScheduleInstance,
  ScheduleInstance,
} from './schedule-instance.js';

export interface InstancesRepository {
  /** Stores the new ones and skips those already present; returns how many were created. */
  createMany(items: NewScheduleInstance[]): Promise<number>;
  /**
   * Occurrences overlapping [from, to] (`startsAt <= to && endsAt >= from`),
   * ordered by start then id, optionally limited to some schedules.
   */
  findInRange(
    from: Date,
    to: Date,
    scheduleIds?: string[],
  ): Promise<ScheduleInstance[]>;
  /** Occurrences with those ids, in no particular order. */
  findByIds(ids: string[]): Promise<ScheduleInstance[]>;
  /** Occurrences of these schedules on or after a Bogota date, by date. */
  findFromDate(
    scheduleIds: string[],
    fromDate: string,
  ): Promise<ScheduleInstance[]>;
  /**
   * Deletes occurrences by id and returns how many were removed. Stores that
   * can see attendance and alarms (the database) refuse to delete an
   * occurrence that has any: the cascade must never erase history.
   */
  deleteByIds(ids: string[]): Promise<number>;
  /** Moves an occurrence in time (its schedule changed hours). */
  updateTimes(id: string, startsAt: Date, endsAt: Date): Promise<void>;
}

export const INSTANCES_REPOSITORY = Symbol('INSTANCES_REPOSITORY');
