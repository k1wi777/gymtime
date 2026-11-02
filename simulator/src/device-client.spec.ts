import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { Backoff } from './backoff.js';
import { DeviceClient } from './device-client.js';
import type { Logger } from './logger.js';

const config = (port: number) => ({
  url: `ws://127.0.0.1:${port}/device`,
  deviceId: 'sim-test',
  token: 'token-for-tests-1234',
  fw: 'sim-test-1',
});

const frame = (
  type: string,
  payload: object,
  extra: Record<string, unknown> = {},
) => ({
  v: 1,
  id: randomUUID(),
  type,
  ts: 1_700_000_000,
  ref: null,
  payload,
  ...extra,
});

describe('DeviceClient', () => {
  let wss: WebSocketServer;
  let port: number;
  let sockets: WebSocket[];
  let received: any[];
  let onConnection: (socket: WebSocket) => void;
  let clients: DeviceClient[];
  const logs: string[] = [];
  const logger: Logger = {
    frame: (dir, raw) => logs.push(`${dir} ${raw}`),
    state: (t) => logs.push(t),
    warn: (t) => logs.push(`WARN ${t}`),
  };

  /** Default server behaviour: answer hello with hello.ok (heartbeat 1 s). */
  const welcome =
    (heartbeatSec = 1) =>
    (socket: WebSocket) => {
      socket.on('message', (data) => {
        const msg = JSON.parse((data as Buffer).toString());
        received.push(msg);
        if (msg.type === 'hello') {
          socket.send(
            JSON.stringify(
              frame(
                'hello.ok',
                { serverTime: 1_700_000_000, heartbeatSec },
                { ref: msg.id },
              ),
            ),
          );
        } else if (msg.type !== 'ack') {
          socket.send(
            JSON.stringify(frame('ack', { ok: true }, { ref: msg.id })),
          );
        }
      });
    };

  const newClient = (options = {}) => {
    const client = new DeviceClient(config(port), logger, {
      backoff: new Backoff(20, 80),
      ...options,
    });
    clients.push(client);
    client.start();
    return client;
  };

  beforeEach(async () => {
    received = [];
    sockets = [];
    clients = [];
    logs.length = 0;
    onConnection = welcome();
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    wss.on('connection', (socket) => {
      sockets.push(socket);
      onConnection(socket);
    });
    await new Promise((r) => wss.once('listening', r));
    port = (wss.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await Promise.all(clients.map((c) => c.stop()));
    wss.clients.forEach((c) => c.terminate());
    await new Promise((r) => wss.close(r));
  });

  it('sends hello first, goes online on hello.ok and sends status', async () => {
    const client = newClient();
    await vi.waitFor(() => expect(client.state).toBe('online'));
    expect(received[0]).toMatchObject({
      type: 'hello',
      payload: {
        deviceId: 'sim-test',
        token: 'token-for-tests-1234',
        fw: 'sim-test-1',
      },
    });
    await vi.waitFor(() =>
      expect(received.some((m) => m.type === 'status')).toBe(true),
    );
  });

  it('keeps sending status every heartbeatSec', async () => {
    newClient();
    await vi.waitFor(
      () =>
        expect(
          received.filter((m) => m.type === 'status').length,
        ).toBeGreaterThanOrEqual(2),
      { timeout: 3000 },
    );
  });

  it('acks a server message and acks a repeated id without reprocessing', async () => {
    const client = newClient();
    await vi.waitFor(() => expect(client.state).toBe('online'));
    const msg = frame('display.message', {
      line1: 'a',
      line2: 'b',
      durationSec: 3,
    });
    sockets[0].send(JSON.stringify(msg));
    sockets[0].send(JSON.stringify(msg));
    await vi.waitFor(() =>
      expect(
        received.filter((m) => m.type === 'ack' && m.ref === msg.id),
      ).toHaveLength(2),
    );
    const handled = logs.filter((l) =>
      l.startsWith('received display.message'),
    );
    expect(handled).toHaveLength(1);
    expect(received.find((m) => m.type === 'ack')).toMatchObject({
      payload: { ok: true },
    });
  });

  it('answers an invalid message with an error ack when the id is recoverable', async () => {
    const client = newClient();
    await vi.waitFor(() => expect(client.state).toBe('online'));
    const bad = frame('display.message', { line1: 1 });
    sockets[0].send(JSON.stringify(bad));
    await vi.waitFor(() =>
      expect(received).toContainEqual(
        expect.objectContaining({
          type: 'ack',
          ref: bad.id,
          payload: { ok: false, error: 'INVALID_MESSAGE' },
        }),
      ),
    );
  });

  it('discards an invalid message without a usable id', async () => {
    const client = newClient();
    await vi.waitFor(() => expect(client.state).toBe('online'));
    const before = received.length;
    sockets[0].send('not json');
    await vi.waitFor(() =>
      expect(logs.some((l) => l.includes('discarded'))).toBe(true),
    );
    expect(received.slice(before).filter((m) => m.type === 'ack')).toHaveLength(
      0,
    );
  });

  it('resends an unacked status with the same id, then closes and reconnects', async () => {
    onConnection = (socket) => {
      socket.on('message', (data) => {
        const msg = JSON.parse((data as Buffer).toString());
        received.push(msg);
        if (msg.type === 'hello') {
          socket.send(
            JSON.stringify(
              frame(
                'hello.ok',
                { serverTime: 1, heartbeatSec: 60 },
                { ref: msg.id },
              ),
            ),
          );
        }
        // status is never acked
      });
    };
    newClient({ ackTimeoutMs: 40, maxResends: 3 });
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(2), {
      timeout: 3000,
    });
    const statuses = received.filter((m) => m.type === 'status');
    const firstId = statuses[0].id;
    expect(statuses.filter((m) => m.id === firstId)).toHaveLength(4);
    expect(logs.some((l) => l.includes('closing to reconnect'))).toBe(true);
    expect(
      received.filter((m) => m.type === 'hello').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('reconnects with a new hello after the server closes the socket', async () => {
    const client = newClient();
    await vi.waitFor(() => expect(client.state).toBe('online'));
    sockets[0].close();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    await vi.waitFor(() => expect(client.state).toBe('online'));
    expect(received.filter((m) => m.type === 'hello')).toHaveLength(2);
  });

  it('logs UNAUTHORIZED explicitly and keeps cycling', async () => {
    onConnection = (socket) => {
      socket.on('message', (data) => {
        const msg = JSON.parse((data as Buffer).toString());
        socket.send(
          JSON.stringify(
            frame('ack', { ok: false, error: 'UNAUTHORIZED' }, { ref: msg.id }),
          ),
        );
        socket.close(1008);
      });
    };
    const client = newClient();
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThanOrEqual(2), {
      timeout: 3000,
    });
    expect(
      logs.some((l) => l.includes('UNAUTHORIZED (wrong device token)')),
    ).toBe(true);
    expect(client.state).not.toBe('online');
  });

  it('retries while the server is down', async () => {
    await new Promise((r) => wss.close(r));
    wss.clients.forEach((c) => c.terminate());
    const client = newClient();
    await vi.waitFor(
      () =>
        expect(
          logs.filter((l) => l.startsWith('connecting')).length,
        ).toBeGreaterThanOrEqual(3),
      { timeout: 3000 },
    );
    expect(client.state).not.toBe('online');
    wss = new WebSocketServer({ port, host: '127.0.0.1' });
    wss.on('connection', (socket) => {
      sockets.push(socket);
      onConnection(socket);
    });
    await vi.waitFor(() => expect(client.state).toBe('online'), {
      timeout: 3000,
    });
  });
});
