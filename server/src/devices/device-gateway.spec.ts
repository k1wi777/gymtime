import { EventEmitter } from 'node:events';
import type { HttpAdapterHost } from '@nestjs/core';
import type { WebSocket } from 'ws';
import { SystemEventsService } from '../common/events/system-events.service.js';
import type { SystemEvent } from '../common/events/system-event.js';
import { ConnectionRegistry } from './connection-registry.js';
import { DeviceGateway } from './device-gateway.js';
import { defaultDevicesConfig } from './devices.config.js';
import { DevicesService } from './devices.service.js';
import { InMemoryDeviceCommandsRepository } from './infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';
import type { Action, MessageProcessor } from './message-processor.service.js';
import type { OutboundSender } from './outbound-sender.service.js';
import { helloFrame, statusFrame } from './testing/frames.js';

const TOKEN = 'device-token-123456';

interface FakeSocket {
  ws: WebSocket;
  emitter: EventEmitter;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function fakeSocket(): FakeSocket {
  const emitter = new EventEmitter();
  const send = vi.fn();
  const close = vi.fn((code: number, reason: string) => {
    ws.readyState = 3;
    emitter.emit('close', code, reason);
  });
  const ws = {
    OPEN: 1,
    readyState: 1,
    on: emitter.on.bind(emitter),
    send,
    close,
  };
  return {
    ws: ws as unknown as WebSocket,
    emitter,
    send,
    close,
  };
}

function build() {
  vi.useFakeTimers();
  const server = new EventEmitter();
  const httpAdapterHost = {
    httpAdapter: { getHttpServer: () => server },
  } as unknown as HttpAdapterHost;
  const commands = new InMemoryDeviceCommandsRepository();
  const devices = new DevicesService(new InMemoryDevicesRepository(), commands);
  const registry = new ConnectionRegistry();
  const events = new SystemEventsService();
  const sender = {
    handleDisconnect: vi.fn(async () => undefined),
    replayPending: vi.fn(async () => undefined),
    resetSentToPending: vi.fn(async () => 0),
  } as unknown as OutboundSender;
  const processor = {
    process: vi.fn(async (_session, raw: string): Promise<Action[]> => {
      const parsed = JSON.parse(raw) as { type: string };
      if (parsed.type !== 'hello') return [];
      await devices.markOnline('d1', '1.0.0');
      return [
        { kind: 'authenticated', deviceId: 'd1', firmwareVersion: '1.0.0' },
      ];
    }),
  } as unknown as MessageProcessor;
  const gateway = new DeviceGateway(
    httpAdapterHost,
    processor,
    devices,
    registry,
    sender,
    events,
    defaultDevicesConfig,
  );
  const received: SystemEvent[] = [];
  events.events.subscribe((event) => received.push(event));
  return { gateway, server, devices, registry, sender, received };
}

afterEach(() => vi.useRealTimers());

describe('DeviceGateway heartbeat (R8–R10)', () => {
  it('closes an authenticated connection that stops sending traffic', async () => {
    const { gateway, devices, registry, sender, received } = build();
    await gateway.onApplicationBootstrap();
    const socket = fakeSocket();
    (gateway as unknown as { onConnection(ws: WebSocket): void }).onConnection(
      socket.ws,
    );
    socket.emitter.emit('message', Buffer.from(helloFrame(TOKEN)), false);
    await vi.advanceTimersByTimeAsync(0);
    expect(registry.get('d1')).toBeDefined();

    await vi.advanceTimersByTimeAsync(
      defaultDevicesConfig.heartbeatTimeoutMs - 1,
    );
    expect(socket.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(socket.close).toHaveBeenCalledWith(4402, 'heartbeat timeout');
    await vi.advanceTimersByTimeAsync(0);

    expect(await devices.listStatus()).toMatchObject([{ online: false }]);
    expect(sender.handleDisconnect).toHaveBeenCalledWith('d1');
    expect(received).toContainEqual(
      expect.objectContaining({
        type: 'device.disconnected',
        data: { deviceId: 'd1', reason: 'heartbeat_timeout' },
      }),
    );
  });

  it('stays online while the device sends its heartbeat', async () => {
    const { gateway } = build();
    await gateway.onApplicationBootstrap();
    const socket = fakeSocket();
    (gateway as unknown as { onConnection(ws: WebSocket): void }).onConnection(
      socket.ws,
    );
    socket.emitter.emit('message', Buffer.from(helloFrame(TOKEN)), false);
    await vi.advanceTimersByTimeAsync(0);

    const half = defaultDevicesConfig.heartbeatTimeoutMs / 2;
    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(half);
      expect(socket.close).not.toHaveBeenCalled();
      socket.emitter.emit('message', Buffer.from(statusFrame()), false);
      await vi.advanceTimersByTimeAsync(0);
    }
  });
});

describe('DeviceGateway events (R11, R13)', () => {
  it('emits device.connected with the firmware and device.disconnected', async () => {
    const { gateway, received } = build();
    await gateway.onApplicationBootstrap();
    const socket = fakeSocket();
    (gateway as unknown as { onConnection(ws: WebSocket): void }).onConnection(
      socket.ws,
    );
    socket.emitter.emit('message', Buffer.from(helloFrame(TOKEN)), false);
    await vi.advanceTimersByTimeAsync(0);

    expect(received).toContainEqual(
      expect.objectContaining({
        type: 'device.connected',
        data: { deviceId: 'd1', firmwareVersion: '1.0.0' },
      }),
    );

    socket.emitter.emit('close', 1000, '');
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toContainEqual(
      expect.objectContaining({
        type: 'device.disconnected',
        data: { deviceId: 'd1', reason: 'closed' },
      }),
    );
  });

  it('replays queued orders as soon as the device authenticates', async () => {
    const { gateway, sender } = build();
    await gateway.onApplicationBootstrap();
    const socket = fakeSocket();
    (gateway as unknown as { onConnection(ws: WebSocket): void }).onConnection(
      socket.ws,
    );
    socket.emitter.emit('message', Buffer.from(helloFrame(TOKEN)), false);
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.replayPending).toHaveBeenCalledWith('d1');
  });
});
