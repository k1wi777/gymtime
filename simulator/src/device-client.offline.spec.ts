import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { Backoff } from './backoff.js';
import { DeviceClient } from './device-client.js';
import type { Logger } from './logger.js';

const NOW = 1_760_000_500_000;
const START = 1_760_000_400;

const frame = (type: string, payload: object, ref: string | null = null) => ({
  v: 1,
  id: randomUUID(),
  type,
  ts: START,
  ref,
  payload,
});

describe('DeviceClient in offline mode', () => {
  let wss: WebSocketServer;
  let port: number;
  let received: any[];
  let rejectBatches = false;
  const clients: DeviceClient[] = [];
  const logs: string[] = [];
  const logger: Logger = {
    frame: () => {},
    state: (t) => logs.push(t),
    warn: (t) => logs.push(`WARN ${t}`),
  };
  const snapshotId = randomUUID();

  const onConnection = (socket: WebSocket) => {
    socket.on('message', (data) => {
      const msg = JSON.parse((data as Buffer).toString());
      received.push(msg);
      if (msg.type === 'hello') {
        socket.send(
          JSON.stringify(
            frame('hello.ok', { serverTime: START, heartbeatSec: 30 }, msg.id),
          ),
        );
        if (msg.payload.capabilities?.includes('offline')) {
          socket.send(
            JSON.stringify(
              frame('offline.snapshot', {
                snapshotId,
                generatedAt: START - 100,
                schedule: {
                  scheduleId: 'sch-1',
                  start: START,
                  end: START + 3600,
                  entryOpensAt: START - 300,
                  entryClosesAt: START + 3300,
                },
                roster: [
                  { slot: 1, name: 'Ana Gomez' },
                  { slot: 2, name: 'Luis Mora' },
                ],
                open: [],
                exited: [],
                limits: { queueMax: 500, batchMax: 50 },
              }),
            ),
          );
        }
      } else if (msg.type !== 'ack') {
        const ok = !(msg.type === 'offline.events' && rejectBatches);
        socket.send(
          JSON.stringify(
            frame('ack', ok ? { ok } : { ok, error: 'INTERNAL_ERROR' }, msg.id),
          ),
        );
      }
    });
  };

  const config = (offline?: { clockOffsetSec: number; stateFile: null }) => ({
    url: `ws://127.0.0.1:${port}/device`,
    deviceId: 'sim-offline',
    token: 'token-for-tests-1234',
    fw: 'sim-test-1',
    enroll: {
      mode: 'ok' as const,
      stepMs: 5,
      failReason: 'x',
      templateBytes: 512,
    },
    ...(offline ? { offline } : {}),
  });

  const newClient = (offline?: { clockOffsetSec: number; stateFile: null }) => {
    const client = new DeviceClient(config(offline), logger, {
      now: () => NOW,
      backoff: new Backoff(20, 80),
    });
    clients.push(client);
    client.start();
    return client;
  };

  beforeEach(async () => {
    received = [];
    rejectBatches = false;
    logs.length = 0;
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    wss.on('connection', onConnection);
    await new Promise((r) => wss.once('listening', r));
    port = (wss.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.stop()));
    wss.clients.forEach((c) => c.terminate());
    await new Promise((r) => wss.close(r));
  });

  it('without --offline the hello is the v0 one and no snapshot is stored', async () => {
    const client = newClient();
    await vi.waitFor(() => expect(client.state).toBe('online'));
    expect(received[0].payload).toEqual({
      deviceId: 'sim-offline',
      token: 'token-for-tests-1234',
      fw: 'sim-test-1',
    });
    expect(client.offlineParts).toBeNull();
  });

  it('declares the capability, applies the clock offset and keeps the snapshot', async () => {
    const client = newClient({ clockOffsetSec: 20, stateFile: null });
    await vi.waitFor(() =>
      expect(client.offlineParts?.engine.snapshot).not.toBeNull(),
    );
    expect(received[0].payload).toMatchObject({
      capabilities: ['offline'],
      deviceTime: NOW / 1000 + 20,
      queued: 0,
    });
    expect(received[0].ts).toBe(NOW / 1000 + 20);
  });

  it('decides alone while the link is down and delivers the queue on reconnect', async () => {
    const client = newClient({ clockOffsetSec: 0, stateFile: null });
    await vi.waitFor(() =>
      expect(client.offlineParts?.engine.snapshot).not.toBeNull(),
    );
    client.disconnect();
    await vi.waitFor(() => expect(client.state).toBe('backoff'));
    const before = received.length;
    client.scan(1);
    client.scan(1);
    expect(client.queued).toBe(2);
    expect(received.length).toBe(before);

    client.reconnect();
    await vi.waitFor(() => expect(client.queued).toBe(0));
    const hellos = received.filter((m) => m.type === 'hello');
    expect(hellos[1].payload.queued).toBe(2);
    const batch = received.find((m) => m.type === 'offline.events');
    expect(batch.payload).toMatchObject({ batch: 1, last: true });
    expect(batch.payload.events.map((e: any) => e.type)).toEqual([
      'entry',
      'exit',
    ]);
    expect(batch.payload.events[0]).toMatchObject({
      ts: NOW / 1000,
      snapshotId,
    });
  });

  it('keeps the queue and resends the same event ids after a rejected batch', async () => {
    const client = newClient({ clockOffsetSec: 0, stateFile: null });
    await vi.waitFor(() =>
      expect(client.offlineParts?.engine.snapshot).not.toBeNull(),
    );
    client.disconnect();
    await vi.waitFor(() => expect(client.state).toBe('backoff'));
    client.scan(2);
    rejectBatches = true;
    client.reconnect();
    await vi.waitFor(() =>
      expect(received.filter((m) => m.type === 'offline.events')).toHaveLength(
        1,
      ),
    );
    await vi.waitFor(() =>
      expect(logs.join('\n')).toMatch(/server rejected offline batch/),
    );
    expect(client.queued).toBe(1);

    rejectBatches = false;
    client.disconnect();
    await vi.waitFor(() => expect(client.state).toBe('backoff'));
    client.reconnect();
    await vi.waitFor(() => expect(client.queued).toBe(0));
    const batches = received.filter((m) => m.type === 'offline.events');
    expect(batches[1].payload.events[0].id).toBe(
      batches[0].payload.events[0].id,
    );
    expect(batches[1].id).not.toBe(batches[0].id);
  });

  it('online, scans still go to the server', async () => {
    const client = newClient({ clockOffsetSec: 0, stateFile: null });
    await vi.waitFor(() => expect(client.state).toBe('online'));
    client.scan(1);
    await vi.waitFor(() =>
      expect(received.some((m) => m.type === 'fingerprint.scan')).toBe(true),
    );
    expect(client.queued).toBe(0);
  });
});
