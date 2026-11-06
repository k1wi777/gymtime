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
  /**
   * Period a recurring schedule belongs to; null for one-off schedules and for
   * the recurring ones created before periods existed (they keep the
   * short-horizon behaviour of iteration 1).
   */
  periodId: string | null;
}

export type NewSchedule = Omit<Schedule, 'id'>;

/** What can change on an existing schedule (never its kind or period). */
export type SchedulePatch = Partial<
  Pick<
    Schedule,
    'name' | 'startTime' | 'endTime' | 'entryOpenMinutes' | 'entryCloseMinutes'
  > & { weekday: number }
>;

/** Largest accepted entry margin; also bounds the lookup of candidate occurrences. */
export const MAX_ENTRY_MARGIN_MINUTES = 240;

export class ScheduleValidationError extends Error {}

/** Another schedule of the same period and weekday overlaps in time (one reader). */
export class ScheduleOverlapError extends Error {
  constructor(readonly conflict: { id: string; name: string }) {
    super(`El horario se cruza con "${conflict.name}"`);
  }
}

/** The schedule has attendance and cannot be deleted (the history is kept). */
export class ScheduleHasAttendanceError extends Error {
  constructor() {
    super('El horario tiene asistencia registrada y no se puede eliminar');
  }
}

/** True when [start, end) of both schedules intersect (HH:mm:ss strings). */
export const timesOverlap = (
  a: Pick<Schedule, 'startTime' | 'endTime'>,
  b: Pick<Schedule, 'startTime' | 'endTime'>,
): boolean => a.startTime < b.endTime && b.startTime < a.endTime;
