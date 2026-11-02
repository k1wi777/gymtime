export interface SchedulesConfig {
  /** Default minutes before the start when entry opens (ENTRY_OPEN_MINUTES). */
  entryOpenMinutes: number;
  /** Default minutes before the end when entry closes (ENTRY_CLOSE_MINUTES). */
  entryCloseMinutes: number;
  /** Days after today for which occurrences are generated. */
  instanceHorizonDays: number;
}

export const SCHEDULES_CONFIG = Symbol('SCHEDULES_CONFIG');

export const INSTANCE_HORIZON_DAYS = 2;
