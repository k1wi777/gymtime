/**
 * Extension point for the alarm module (E8): attendance only reports that an
 * occurrence has no open sessions left, so the alarm can be turned off. The
 * real implementation will replace `NoopAlarmPort` without touching attendance.
 */
export interface AlarmPort {
  onInstanceEmptied(instanceId: string): Promise<void> | void;
}

export const ALARM_PORT = Symbol('ALARM_PORT');

export class NoopAlarmPort implements AlarmPort {
  onInstanceEmptied(): void {
    // E8 is out of scope: the port exists but does nothing yet.
  }
}
