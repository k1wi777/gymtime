export interface AlarmConfig {
  /** Duration of the short beep when a schedule ends empty (ALARM_BEEP_SECONDS). */
  beepSeconds: number;
  /** Minutes after the end before abandoned sessions are closed (ALARM_TIMEOUT_MINUTES). */
  timeoutMinutes: number;
  /** Scheduler tick; 500 ms keeps the end-of-schedule check within ±1 s. */
  tickMs: number;
}

export const ALARM_CONFIG = Symbol('ALARM_CONFIG');

/** Internal, not configurable: the precision requirement is ±1 s. */
export const ALARM_TICK_MS = 500;

export const defaultAlarmConfig: AlarmConfig = {
  beepSeconds: 5,
  timeoutMinutes: 30,
  tickMs: ALARM_TICK_MS,
};
