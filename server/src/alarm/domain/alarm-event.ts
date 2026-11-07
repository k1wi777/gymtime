import type { ALARM_REASONS } from '@gymtime/shared';

/** Reason carried by `alarm.set`; matches the shared protocol enum. */
export type AlarmReason = (typeof ALARM_REASONS)[number];

/** `server` drove the siren; `local` was sounded by the reader while offline. */
export type AlarmOrigin = 'server' | 'local';

/** Who silenced the alarm; matches the `alarm_closed_by` enum. */
export type AlarmClosedBy = 'all_exited' | 'button' | 'cli' | 'timeout';

/**
 * One continuous alarm of an occurrence. Only `PENDING_EXIT` creates a row;
 * an open row (`endedAt` null) is both the record and the idempotency marker
 * that the end of that occurrence was already processed. `local` rows (H12)
 * are born closed, never count as open and never drive the siren.
 */
export interface AlarmEvent {
  id: string;
  instanceId: string;
  startedAt: Date;
  endedAt: Date | null;
  closedBy: AlarmClosedBy | null;
  closedSessions: number;
  origin: AlarmOrigin;
  /** Reader and its own event id, only for `local` rows (idempotency). */
  deviceId: string | null;
  deviceEventId: string | null;
}

export interface NewAlarmEvent {
  instanceId: string;
  startedAt: Date;
}

/** An alarm the reader sounded offline, already finished. */
export interface NewLocalAlarmEvent {
  instanceId: string;
  startedAt: Date;
  endedAt: Date;
  closedBy: AlarmClosedBy;
  deviceId: string;
  deviceEventId: string;
}

export interface CloseAlarmEvent {
  endedAt: Date;
  closedBy: AlarmClosedBy;
  closedSessions: number;
}

/** What the operator sees, both in REST and in `gym alarm status`. */
export interface AlarmStatus {
  on: boolean;
  reason: AlarmReason | null;
  instanceId: string | null;
  durationSec: number | null;
  startedAt: Date | null;
  /** Open sessions right now, not only those of the alarmed occurrence. */
  openSessions: number;
}

export interface AlarmOffResult {
  closedBy: AlarmClosedBy;
  sessionsClosed: number;
  status: AlarmStatus;
}
