import type { ALARM_REASONS, RejectReason } from '@gymtime/shared';

/** Data carried by every event type; this map is the source of the SSE schema. */
export interface SystemEventMap {
  'device.connected': { deviceId: string; firmwareVersion: string };
  'device.disconnected': {
    deviceId: string;
    reason:
      | 'closed'
      | 'replaced'
      | 'heartbeat_timeout'
      | 'server_shutdown'
      | 'token_revoked';
  };
  /** A device that had connected has been offline longer than the threshold. */
  'device.offline_alert': {
    deviceId: string;
    offlineMinutes: number;
    thresholdMinutes: number;
  };
  scan: {
    deviceId: string;
    slot: number | null;
    result: 'entry' | 'exit' | 'denied' | 'unknown';
    studentId: string | null;
    studentName: string | null;
    reason: RejectReason | null;
  };
  command: {
    deviceId: string;
    commandId: string;
    commandType: string;
    status: 'pending' | 'sent' | 'acked' | 'failed';
    attempts: number;
  };
  alarm: {
    on: boolean;
    reason: (typeof ALARM_REASONS)[number];
    closedBy: 'all_exited' | 'button' | 'cli' | 'timeout' | null;
    sessionsClosed: number;
  };
  /** An attendance session was opened or closed (by fingerprint or by hand). */
  attendance: {
    change: 'entry' | 'exit';
    source: 'device' | 'manual';
    studentId: string;
    studentName: string;
    instanceId: string;
    sessionId: string;
  };
  /** An enrollment was created or changed state or step. Never the template. */
  enrollment: {
    enrollmentId: string;
    studentId: string;
    deviceId: string;
    status:
      'pending' | 'in_progress' | 'done' | 'failed' | 'expired' | 'cancelled';
    step: string | null;
    failureReason: string | null;
  };
  keepalive: Record<string, never>;
}

/** Event types published on the in-process bus and streamed over SSE. */
export const SYSTEM_EVENT_TYPES = [
  'device.connected',
  'device.disconnected',
  'device.offline_alert',
  'scan',
  'command',
  'alarm',
  'attendance',
  'enrollment',
  'keepalive',
] as const satisfies ReadonlyArray<keyof SystemEventMap>;

export type SystemEventType = keyof SystemEventMap;

/** Wire shape of an event: `{ type, at, data }`. */
export type SystemEvent = {
  [K in SystemEventType]: {
    type: K;
    /** ISO-8601 instant of the event. */
    at: string;
    data: SystemEventMap[K];
  };
}[SystemEventType];
