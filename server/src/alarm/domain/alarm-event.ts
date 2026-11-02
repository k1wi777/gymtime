import type { ALARM_REASONS } from '@gymtime/shared';

/** Reason carried by `alarm.set`; matches the shared protocol enum. */
export type AlarmReason = (typeof ALARM_REASONS)[number];

/** Who silenced the alarm; matches the `alarm_closed_by` enum. */
export type AlarmClosedBy = 'all_exited' | 'button' | 'cli' | 'timeout';

/**
 * One continuous alarm of an occurrence. Only `PENDING_EXIT` creates a row;
 * an open row (`endedAt` null) is both the record and the idempotency marker
 * that the end of that occurrence was already processed.
 */
export interface AlarmEvent {
  id: string;
  instanceId: string;
  startedAt: Date;
  endedAt: Date | null;
  closedBy: AlarmClosedBy | null;
  closedSessions: number;
}

export interface NewAlarmEvent {
  instanceId: string;
  startedAt: Date;
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
