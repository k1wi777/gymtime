import type { SystemEventMap } from './system-event.js';

/** Complete event payloads for specs that only care about the envelope. */
export const scanData = (
  overrides: Partial<SystemEventMap['scan']> = {},
): SystemEventMap['scan'] => ({
  deviceId: 'd1',
  slot: 5,
  result: 'entry',
  studentId: null,
  studentName: null,
  reason: null,
  ...overrides,
});

export const alarmData = (
  overrides: Partial<SystemEventMap['alarm']> = {},
): SystemEventMap['alarm'] => ({
  on: true,
  reason: 'MANUAL',
  closedBy: null,
  sessionsClosed: 0,
  ...overrides,
});
