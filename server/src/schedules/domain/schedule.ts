/**
 * A schedule's weekday / date / times are Bogota wall-clock values; its
 * occurrences (`ScheduleInstance`) are absolute UTC instants.
 */
export interface Schedule {
  id: string;
  name: string;
  /** 1 = Monday ... 7 = Sunday; null for a one-off schedule. */
  weekday: number | null;
  /** `YYYY-MM-DD`; null for a recurring schedule. */
  date: string | null;
  /** `HH:mm:ss` */
  startTime: string;
  /** `HH:mm:ss`, always later than `startTime` (no crossing midnight). */
  endTime: string;
  /** Minutes before the start when entry opens; null = configured default. */
  entryOpenMinutes: number | null;
  /** Minutes before the end when entry closes; null = configured default. */
  entryCloseMinutes: number | null;
}

export type NewSchedule = Omit<Schedule, 'id'>;

/** Largest accepted entry margin; also bounds the lookup of candidate occurrences. */
export const MAX_ENTRY_MARGIN_MINUTES = 240;

export class ScheduleValidationError extends Error {}
