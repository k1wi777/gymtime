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
}

export const INSTANCES_REPOSITORY = Symbol('INSTANCES_REPOSITORY');
