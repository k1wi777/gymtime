import { randomUUID } from 'node:crypto';

/** Test helper: builds a device frame with the protocol envelope. */
export function frame(
  type: string,
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    v: 1,
    id: randomUUID(),
    type,
    ts: 1_700_000_000,
    ref: null,
    payload,
    ...overrides,
  });
}

export const helloFrame = (token: string, deviceId = 'esp32-1') =>
  frame('hello', { deviceId, token, fw: '1.0.0' });

export const statusFrame = (id: string = randomUUID()) =>
  frame(
    'status',
    { uptime: 1, heap: 2, rssi: -50, fingerprintCount: 3 },
    { id },
  );
