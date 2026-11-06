import { randomUUID } from 'node:crypto';
import type { ServerMessage } from '@gymtime/shared';
import { SystemEventsService } from '../common/events/system-events.service.js';
import type { SystemEvent } from '../common/events/system-event.js';
import {
  ConnectionRegistry,
  type DeviceConnection,
} from './connection-registry.js';
import { DevicesService } from './devices.service.js';
import { InMemoryDeviceCommandsRepository } from './infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';
import { OutboundSender } from './outbound-sender.service.js';

const config = {
  helloTimeoutMs: 5000,
  ackTimeoutMs: 5000,
  maxResends: 3,
  heartbeatSec: 30,
  heartbeatTimeoutMs: 60000,
};

const message = (): ServerMessage => ({
  v: 1,
  id: randomUUID(),
  type: 'alarm.set',
  ts: 1_700_000_000,
  ref: null,
  payload: { on: true, durationSec: null, reason: 'TEST' },
});

const flush = async (times = 10): Promise<void> => {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
};

function build() {
  vi.useFakeTimers();
  const registry = new ConnectionRegistry();
  const commands = new InMemoryDeviceCommandsRepository();
  const devices = new DevicesService(new InMemoryDevicesRepository(), commands);
  const events = new SystemEventsService();
  const sender = new OutboundSender(
    registry,
    devices,
    config,
    commands,
    events,
  );
  const send = vi.fn<DeviceConnection['send']>();
  const connection: DeviceConnection = { send, close: vi.fn() };
  return { registry, commands, devices, events, sender, send, connection };
}

afterEach(() => vi.useRealTimers());

describe('OutboundSender.send (in-memory path)', () => {
  it('resolves acked when the device confirms', async () => {
    const { registry, sender, send, connection } = build();
    registry.register('d1', connection);
    const msg = message();
    const result = sender.send('d1', msg);
    sender.handleAck('d1', msg.id);
    expect(await result).toBe('acked');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('resends the same message up to 3 times and then fails', async () => {
    const { registry, sender, send, connection } = build();
    registry.register('d1', connection);
    const msg = message();
    const result = sender.send('d1', msg);
    await vi.advanceTimersByTimeAsync(5000 * 4);
    expect(await result).toBe('failed');
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls.every(([m]) => m === msg)).toBe(true);
  });

  it('fails immediately without an active connection', async () => {
    const { sender } = build();
    expect(await sender.send('other', message())).toBe('failed');
  });

  it('fails pending messages when the connection closes', async () => {
    const { registry, sender, connection } = build();
    registry.register('d1', connection);
    const result = sender.send('d1', message());
    await sender.handleDisconnect('d1');
    expect(await result).toBe('failed');
  });
});

describe('OutboundSender.sendCommand (R1–R4)', () => {
  it('persists the order before transmitting and marks it acked', async () => {
    const { registry, sender, commands, send, connection } = build();
    registry.register('d1', connection);
    const create = vi.spyOn(commands, 'create');
    const msg = message();

    const result = sender.sendCommand('d1', msg);
    await flush();
    sender.handleAck('d1', msg.id);

    expect(await result).toBe('acked');
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0]!,
    );
    expect(await commands.findById(msg.id)).toMatchObject({
      status: 'acked',
      attempts: 1,
      type: 'alarm.set',
    });
    expect(send).toHaveBeenCalledWith(msg);
  });

  it('queues without connection instead of discarding', async () => {
    const { sender, commands } = build();
    const msg = message();
    expect(await sender.sendCommand('d1', msg)).toBe('queued');
    expect(await commands.findById(msg.id)).toMatchObject({
      status: 'pending',
      attempts: 0,
    });
  });

  it('retries the same id and fails after the configured attempts', async () => {
    const { registry, sender, commands, send, connection } = build();
    registry.register('d1', connection);
    const msg = message();
    const result = sender.sendCommand('d1', msg);

    await vi.advanceTimersByTimeAsync(config.ackTimeoutMs * 4);
    await flush();

    expect(await result).toBe('failed');
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls.every(([m]) => m.id === msg.id)).toBe(true);
    expect(await commands.findById(msg.id)).toMatchObject({
      status: 'failed',
      attempts: 4,
    });
  });

  it('fails the order when it cannot be persisted', async () => {
    const { registry, sender, send, connection } = build();
    registry.register('d1', connection);
    vi.spyOn(
      InMemoryDeviceCommandsRepository.prototype,
      'create',
    ).mockRejectedValueOnce(new Error('db down'));

    expect(await sender.sendCommand('d1', message())).toBe('failed');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('OutboundSender queues (R5–R7)', () => {
  it('replays pending orders in creation order when the device reconnects', async () => {
    const { registry, sender, commands, send, connection } = build();
    const first = message();
    const second = message();
    await sender.sendCommand('d1', first);
    vi.advanceTimersByTime(1);
    await sender.sendCommand('d1', second);
    registry.register('d1', connection);

    const replay = sender.replayPending('d1');
    await flush();
    expect(send.mock.calls[0]?.[0].id).toBe(first.id);
    sender.handleAck('d1', first.id);
    await flush();
    expect(send.mock.calls[1]?.[0].id).toBe(second.id);
    sender.handleAck('d1', second.id);
    await replay;

    expect(await commands.findById(first.id)).toMatchObject({
      status: 'acked',
    });
    expect(await commands.findById(second.id)).toMatchObject({
      status: 'acked',
    });
  });

  it('returns in-flight orders to pending on disconnect (R6)', async () => {
    const { registry, sender, commands, connection } = build();
    registry.register('d1', connection);
    const msg = message();
    const result = sender.sendCommand('d1', msg);
    await flush();

    await sender.handleDisconnect('d1');

    expect(await result).toBe('failed');
    expect(await commands.findById(msg.id)).toMatchObject({
      status: 'pending',
      attempts: 1,
    });
  });

  it('resets sent rows left by a crash', async () => {
    const { sender, commands } = build();
    const msg = message();
    await sender.sendCommand('d1', msg);
    await commands.markSent(msg.id, 1);
    expect(await sender.resetSentToPending()).toBe(1);
    expect(await commands.findById(msg.id)).toMatchObject({
      status: 'pending',
    });
  });

  it('supersedes older unconfirmed orders of the same type (R7)', async () => {
    const { sender, commands } = build();
    const old = message();
    await sender.sendCommand('d1', old);
    const latest = message();
    await sender.sendCommand('d1', latest, { supersedesPrevious: true });

    expect(await commands.findById(old.id)).toMatchObject({ status: 'failed' });
    expect(await commands.findById(latest.id)).toMatchObject({
      status: 'pending',
    });
  });

  it('applies an ack persisted after a restart to the row', async () => {
    const { sender, commands } = build();
    const msg = message();
    await sender.sendCommand('d1', msg);

    sender.handleAck('d1', msg.id);
    await flush();

    expect(await commands.findById(msg.id)).toMatchObject({ status: 'acked' });
  });

  it('ignores an ack of another device', async () => {
    const { sender, commands } = build();
    const msg = message();
    await sender.sendCommand('d1', msg);

    sender.handleAck('d2', msg.id);
    await flush();

    expect(await commands.findById(msg.id)).toMatchObject({
      status: 'pending',
    });
  });
});

describe('OutboundSender command events (R13)', () => {
  it('emits pending, sent and acked with attempts', async () => {
    const { registry, sender, events, connection } = build();
    registry.register('d1', connection);
    const received: SystemEvent[] = [];
    events.events.subscribe((event) => received.push(event));
    const msg = message();

    const result = sender.sendCommand('d1', msg);
    await flush();
    sender.handleAck('d1', msg.id);
    await result;

    expect(
      received.map((event) => (event.data as { status?: string }).status),
    ).toEqual(['pending', 'sent', 'acked']);
    expect(received[0]?.data).toMatchObject({
      deviceId: 'd1',
      commandId: msg.id,
      commandType: 'alarm.set',
      attempts: 0,
    });
  });
});
