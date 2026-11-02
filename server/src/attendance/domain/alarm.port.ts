/**
 * Extension point for the alarm module (E8): attendance reports that an
 * occurrence has no open sessions left and that the physical button was
 * pressed. The real implementation replaces `NoopAlarmPort` without touching
 * attendance.
 */
export interface AlarmPort {
  onInstanceEmptied(instanceId: string): Promise<void> | void;
  onButtonPressed(deviceId: string): Promise<void> | void;
}

export const ALARM_PORT = Symbol('ALARM_PORT');

export class NoopAlarmPort implements AlarmPort {
  onInstanceEmptied(): void {
    // Replaced by the alarm module at startup.
  }

  onButtonPressed(): void {
    // Replaced by the alarm module at startup.
  }
}
