import type { Mock } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ServerMessage } from '@gymtime/shared';
import {
  ConnectionRegistry,
  type DeviceConnection,
} from './connection-registry.js';
import { OutboundSender } from './outbound-sender.service.js';

const config = {
  helloTimeoutMs: 5000,
  ackTimeoutMs: 5000,
  maxResends: 3,
  heartbeatSec: 30,
};

const message: ServerMessage = {
  v: 1,
  id: randomUUID(),
  type: 'alarm.set',
  ts: 1_700_000_000,
  ref: null,
  payload: { on: true, durationSec: null, reason: 'TEST' },
};

describe('OutboundSender', () => {
  let registry: ConnectionRegistry;
  let sender: OutboundSender;
  let connection: DeviceConnection;
  let send: Mock<DeviceConnection['send']>;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new ConnectionRegistry();
    send = vi.fn<DeviceConnection['send']>();
    connection = { send, close: vi.fn() };
    registry.register('d1', connection);
    sender = new OutboundSender(registry, config);
  });

  afterEach(() => vi.useRealTimers());

  it('resolves acked when the device confirms', async () => {
    const result = sender.send('d1', message);
    sender.handleAck('d1', message.id);
    expect(await result).toBe('acked');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('resends the same message up to 3 times and then fails', async () => {
    const result = sender.send('d1', message);
    await vi.advanceTimersByTimeAsync(5000 * 4);
    expect(await result).toBe('failed');
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls.every(([m]) => m === message)).toBe(true);
  });

  it('stops resending once acked after a resend', async () => {
    const result = sender.send('d1', message);
    await vi.advanceTimersByTimeAsync(5000);
    sender.handleAck('d1', message.id);
    expect(await result).toBe('acked');
    await vi.advanceTimersByTimeAsync(20000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('fails immediately without an active connection', async () => {
    expect(await sender.send('other', message)).toBe('failed');
  });

  it('fails pending messages when the connection closes', async () => {
    const result = sender.send('d1', message);
    sender.failPending('d1');
    expect(await result).toBe('failed');
  });

  it('ignores an ack from another device', async () => {
    const result = sender.send('d1', message);
    sender.handleAck('d2', message.id);
    await vi.advanceTimersByTimeAsync(5000 * 4);
    expect(await result).toBe('failed');
  });
});
