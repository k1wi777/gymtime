import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { Backoff } from './backoff.js';
import { DeviceClient } from './device-client.js';
import { createConsoleLogger, type Logger } from './logger.js';

const config = (port: number) => ({
  url: `ws://127.0.0.1:${port}/device`,
  deviceId: 'sim-test',
  token: 'token-for-tests-1234',
  fw: 'sim-test-1',
  enroll: {
    mode: 'ok' as const,
    stepMs: 5,
    failReason: 'sim_fail',
    templateBytes: 512,
  },
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

  it('prints the two lines and the duration of a display.message and acks it (R7)', async () => {
    const client = newClient();
    await vi.waitFor(() => expect(client.state).toBe('online'));
    const msg = frame('display.message', {
      line1: 'Tiempo cumplido',
      line2: 'Registre salida',
      durationSec: 1800,
    });
    sockets[0].send(JSON.stringify(msg));
    await vi.waitFor(() => {
      expect(
        received.filter((m) => m.type === 'ack' && m.ref === msg.id),
      ).toHaveLength(1);
      expect(logs).toContain(
        'display.message: "Tiempo cumplido" / "Registre salida" (1800s)',
      );
    });
    const clear = frame('display.message', {
      line1: '',
      line2: '',
      durationSec: 1,
    });
    sockets[0].send(JSON.stringify(clear));
    await vi.waitFor(() =>
      expect(logs).toContain('display.message: (screen cleared) (1s)'),
    );
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

  describe('enrollment', () => {
    const enrollmentId = randomUUID();
    const startFrame = () =>
      frame('enroll.start', { enrollmentId, scratchSlot: 162, timeoutSec: 60 });
    const ofType = (type: string) => received.filter((m) => m.type === type);

    it('acks enroll.start and answers with four steps and enroll.done', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      const msg = startFrame();
      sockets[0].send(JSON.stringify(msg));
      await vi.waitFor(() => expect(ofType('enroll.done')).toHaveLength(1));
      expect(received.some((m) => m.type === 'ack' && m.ref === msg.id)).toBe(
        true,
      );
      expect(ofType('enroll.progress').map((m) => m.payload.step)).toEqual([
        'place_finger',
        'remove_finger',
        'place_again',
        'processing',
      ]);
      const done = ofType('enroll.done')[0];
      expect(done.payload.enrollmentId).toBe(enrollmentId);
      expect(Buffer.from(done.payload.template, 'base64')).toHaveLength(512);
    });

    it('never logs the template', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      sockets[0].send(JSON.stringify(startFrame()));
      await vi.waitFor(() => expect(ofType('enroll.done')).toHaveLength(1));
      const template = ofType('enroll.done')[0].payload.template as string;
      // The test logger stores raw frames, so redaction is checked in logger.spec;
      // here only the state log (which the client writes itself) is inspected.
      expect(logs.filter((l) => !/^(in|out) /.test(l))).not.toEqual(
        expect.arrayContaining([expect.stringContaining(template)]),
      );
    });

    it('stops sending steps after enroll.cancel', async () => {
      const client = new DeviceClient(
        {
          ...config(port),
          enroll: { ...config(port).enroll, stepMs: 80 },
        },
        logger,
        { backoff: new Backoff(20, 80) },
      );
      clients.push(client);
      client.start();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      sockets[0].send(JSON.stringify(startFrame()));
      await vi.waitFor(() =>
        expect(ofType('enroll.progress').length).toBeGreaterThanOrEqual(1),
      );
      sockets[0].send(JSON.stringify(frame('enroll.cancel', { enrollmentId })));
      await new Promise((r) => setTimeout(r, 400));
      expect(ofType('enroll.progress').length).toBeLessThan(4);
      expect(ofType('enroll.done')).toHaveLength(0);
    });

    it('does not restart on a repeated enroll.start frame', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      const msg = startFrame();
      sockets[0].send(JSON.stringify(msg));
      sockets[0].send(JSON.stringify(msg));
      await vi.waitFor(() => expect(ofType('enroll.done')).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 60));
      expect(ofType('enroll.progress')).toHaveLength(4);
      expect(ofType('enroll.done')).toHaveLength(1);
    });

    it('sends nothing after stop', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      sockets[0].send(JSON.stringify(startFrame()));
      await vi.waitFor(() =>
        expect(ofType('enroll.progress').length).toBeGreaterThanOrEqual(1),
      );
      await client.stop();
      const count = received.length;
      await new Promise((r) => setTimeout(r, 100));
      expect(received).toHaveLength(count);
    });
  });
  describe('reader sync (R23, R24)', () => {
    const S1 = '00000000-0000-4000-8000-0000000000a1';
    const S2 = '00000000-0000-4000-8000-0000000000a2';
    const syncFrame = (
      syncId: string,
      index: number,
      total: number,
      slots: number[],
    ) =>
      frame('templates.sync', {
        syncId,
        chunk: { index, total },
        templates: slots.map((slot) => ({
          slot,
          template: Buffer.from(`secret-template-${slot}`).toString('base64'),
        })),
      });
    const ackFor = (id: string) =>
      received.filter((m) => m.type === 'ack' && m.ref === id);
    const lastStatus = () => received.filter((m) => m.type === 'status').at(-1);

    it('acks each chunk, stores the templates and reports them in status', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      const first = syncFrame(S1, 1, 2, [1, 2]);
      const second = syncFrame(S1, 2, 2, [3]);
      sockets[0].send(JSON.stringify(first));
      sockets[0].send(JSON.stringify(second));
      await vi.waitFor(() => {
        expect(ackFor(first.id)).toHaveLength(1);
        expect(ackFor(second.id)).toHaveLength(1);
      });
      expect(
        logs.some((l) => l.includes('sync 2/2') && l.includes('3 in reader')),
      ).toBe(true);
      // the next heartbeat carries the count
      await vi.waitFor(
        () => expect(lastStatus()?.payload.fingerprintCount).toBe(3),
        {
          timeout: 3000,
        },
      );
    });

    it('wipes the reader on a new syncId and ignores a repeated frame', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      const a = syncFrame(S1, 1, 1, [1, 2, 3]);
      const b = syncFrame(S2, 1, 1, [1]);
      sockets[0].send(JSON.stringify(a));
      sockets[0].send(JSON.stringify(a));
      sockets[0].send(JSON.stringify(b));
      await vi.waitFor(() => expect(ackFor(b.id)).toHaveLength(1));
      expect(ackFor(a.id)).toHaveLength(2);
      await vi.waitFor(
        () => expect(lastStatus()?.payload.fingerprintCount).toBe(1),
        {
          timeout: 3000,
        },
      );
    });

    it('never prints templates in the console output', async () => {
      const lines: string[] = [];
      const client = new DeviceClient(
        config(port),
        createConsoleLogger((l) => lines.push(l)),
        {
          backoff: new Backoff(20, 80),
        },
      );
      clients.push(client);
      client.start();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      const msg = syncFrame(S1, 1, 1, [1, 2]);
      sockets[0].send(JSON.stringify(msg));
      await vi.waitFor(() => expect(ackFor(msg.id)).toHaveLength(1));
      const output = lines.join('\n');
      expect(output).toContain('templates.sync');
      expect(output).toContain('2 template(s) stored (slots 1..2)');
      for (const slot of [1, 2]) {
        expect(output).not.toContain(
          Buffer.from(`secret-template-${slot}`).toString('base64'),
        );
      }
    });

    it('acks schedule.set and logs it in Bogota time', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      const msg = frame('schedule.set', {
        scheduleId: 'sch1',
        start: Date.parse('2026-11-02T15:00:00Z') / 1000,
        end: Date.parse('2026-11-02T16:00:00Z') / 1000,
        entryOpensAt: Date.parse('2026-11-02T14:50:00Z') / 1000,
        entryClosesAt: Date.parse('2026-11-02T15:55:00Z') / 1000,
      });
      sockets[0].send(JSON.stringify(msg));
      await vi.waitFor(() => expect(ackFor(msg.id)).toHaveLength(1));
      expect(
        logs.some((l) => l.includes('2026-11-02 10:00:00 to 11:00:00')),
      ).toBe(true);
    });
  });

  describe('alarm (R13)', () => {
    const ackFor = (id: string) =>
      received.filter((m) => m.type === 'ack' && m.ref === id);

    it('shows a continuous alarm and its clearing on the console', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));

      const on = frame('alarm.set', {
        on: true,
        durationSec: null,
        reason: 'PENDING_EXIT',
      });
      sockets[0].send(JSON.stringify(on));
      await vi.waitFor(() => expect(ackFor(on.id)).toHaveLength(1));
      expect(
        logs.some((l) => l.includes('ALARM ON (PENDING_EXIT) continua')),
      ).toBe(true);

      const off = frame('alarm.set', {
        on: false,
        durationSec: null,
        reason: 'CLEARED',
      });
      sockets[0].send(JSON.stringify(off));
      await vi.waitFor(() => expect(ackFor(off.id)).toHaveLength(1));
      expect(logs.some((l) => l.includes('ALARM OFF (CLEARED)'))).toBe(true);
      expect(client.alarm.current).toMatchObject({
        on: false,
        reason: 'CLEARED',
      });
    });

    it('turns itself off after a numeric duration and reports alarm.state', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      const msg = frame('alarm.set', {
        on: true,
        durationSec: 1,
        reason: 'END_BEEP',
      });

      sockets[0].send(JSON.stringify(msg));

      await vi.waitFor(() => expect(ackFor(msg.id)).toHaveLength(1));
      expect(logs.some((l) => l.includes('ALARM ON (END_BEEP) 1 s'))).toBe(true);
      await vi.waitFor(
        () =>
          expect(
            received.some(
              (m) =>
                m.type === 'alarm.state' &&
                m.payload.on === false &&
                m.payload.source === 'local',
            ),
          ).toBe(true),
        { timeout: 3000 },
      );
      expect(logs.some((l) => l.includes('alarm auto-off'))).toBe(true);
      expect(client.alarm.current).toMatchObject({ on: false });
    });
  });

  describe('interactive scan and connection (R19)', () => {
    it('sends a fingerprint.scan with the slot and a fixed confidence', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      client.scan(7);
      await vi.waitFor(() =>
        expect(received.some((m) => m.type === 'fingerprint.scan')).toBe(true),
      );
      expect(received.find((m) => m.type === 'fingerprint.scan')).toMatchObject({
        payload: { slot: 7, confidence: 90 },
      });
    });

    it('sends button.pressed', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      client.pressButton();
      await vi.waitFor(() =>
        expect(received.some((m) => m.type === 'button.pressed')).toBe(true),
      );
      expect(
        received.find((m) => m.type === 'button.pressed')?.payload,
      ).toEqual({});
    });

    it('shows a scan.result and acks it', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      const msg = frame(
        'scan.result',
        {
          result: 'denied',
          studentName: 'Ana',
          reason: 'NOT_IN_SCHEDULE',
          display: {
            line1: 'Ana',
            line2: 'No es su horario',
            color: 'red',
          },
        },
        { ref: randomUUID() },
      );
      sockets[0].send(JSON.stringify(msg));
      await vi.waitFor(() => {
        expect(
          received.filter((m) => m.type === 'ack' && m.ref === msg.id),
        ).toHaveLength(1);
        expect(
          logs.some(
            (l) =>
              l.includes('scan.result denied: Ana (NOT_IN_SCHEDULE)') &&
              l.includes('Ana / No es su horario') &&
              l.includes('red'),
          ),
        ).toBe(true);
      });
    });

    it('stops reconnecting on disconnect and resumes on reconnect', async () => {
      const client = newClient();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      client.disconnect();
      await vi.waitFor(() => expect(client.state).toBe('backoff'));
      await new Promise((r) => setTimeout(r, 150));
      expect(sockets).toHaveLength(1);
      expect(logs.some((l) => l.includes('disconnected manually'))).toBe(true);

      client.reconnect();
      await vi.waitFor(() => expect(client.state).toBe('online'));
      expect(sockets).toHaveLength(2);
    });
  });
});
