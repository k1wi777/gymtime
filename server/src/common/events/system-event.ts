/** Event types published on the in-process bus and streamed over SSE. */
export const SYSTEM_EVENT_TYPES = [
  'device.connected',
  'device.disconnected',
  'scan',
  'command',
  'alarm',
  'keepalive',
] as const;

export type SystemEventType = (typeof SYSTEM_EVENT_TYPES)[number];

/** Wire shape of an event: `{ type, at, data }`. */
export interface SystemEvent {
  type: SystemEventType;
  /** ISO-8601 instant of the event. */
  at: string;
  data: Record<string, unknown>;
}
