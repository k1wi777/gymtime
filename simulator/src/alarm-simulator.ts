import type { ALARM_REASONS, ServerMessage } from '@gymtime/shared';

export type AlarmReason = (typeof ALARM_REASONS)[number];
export type AlarmPayload = Extract<
  ServerMessage,
  { type: 'alarm.set' }
>['payload'];

interface AlarmState {
  on: boolean;
  reason: AlarmReason;
  durationSec: number | null;
}

/**
 * Siren state of the simulated ESP32. Pure: it turns an `alarm.set` into the
 * console line and keeps what is sounding; the timers live in `DeviceClient`.
 */
export class AlarmSimulator {
  private state: AlarmState | null = null;

  get current(): AlarmState | null {
    return this.state ? { ...this.state } : null;
  }

  /** Applies an `alarm.set` and returns its operator-facing line. */
  onSet(payload: AlarmPayload): string {
    this.state = {
      on: payload.on,
      reason: payload.reason,
      durationSec: payload.durationSec,
    };
    if (!payload.on) return `ALARM OFF (${payload.reason})`;
    const duration =
      payload.durationSec === null ? 'continua' : `${payload.durationSec} s`;
    return `ALARM ON (${payload.reason}) ${duration}`;
  }

  /** A numeric duration elapsed: the device turns itself off and reports it. */
  autoOff(): string {
    const reason = this.state?.reason;
    if (reason) this.state = { on: false, reason, durationSec: null };
    return `alarm auto-off${reason ? ` (${reason})` : ''}`;
  }
}
