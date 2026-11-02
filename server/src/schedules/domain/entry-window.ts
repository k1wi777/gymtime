import type { Schedule } from './schedule.js';
import type { ScheduleInstance } from './schedule-instance.js';

export interface EntryDefaults {
  openMinutes: number;
  closeMinutes: number;
}

export interface EntryWindow {
  opensAt: Date;
  closesAt: Date;
}

const MS_PER_MINUTE = 60_000;

/**
 * Entry is accepted from `startsAt - open` until `endsAt - close`. The values
 * come from the schedule when it defines them and from the configured defaults
 * otherwise; it is computed, never stored, so a config change applies at once.
 */
export function entryWindow(
  instance: Pick<ScheduleInstance, 'startsAt' | 'endsAt'>,
  schedule: Pick<Schedule, 'entryOpenMinutes' | 'entryCloseMinutes'>,
  defaults: EntryDefaults,
): EntryWindow {
  const open = schedule.entryOpenMinutes ?? defaults.openMinutes;
  const close = schedule.entryCloseMinutes ?? defaults.closeMinutes;
  return {
    opensAt: new Date(instance.startsAt.getTime() - open * MS_PER_MINUTE),
    closesAt: new Date(instance.endsAt.getTime() - close * MS_PER_MINUTE),
  };
}
