import { randomBytes, randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION, type ServerMessage } from '@gymtime/shared';

const TOKEN = 'device-token-123456';
const ADMIN_KEY = 'admin-key-1234567890';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: TOKEN,
  ADMIN_API_KEY: ADMIN_KEY,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

const { buildInMemoryApp, DEVICE_ID } =
  await import('./support/scenario-app.js');
const { RawDevice } = await import('./support/raw-device.js');
const { DeviceClient } = await import('@gymtime/simulator');
const { OutboundSender } =
  await import('./../src/devices/outbound-sender.service.js');

type Harness = Awaited<ReturnType<typeof buildInMemoryApp>>;
type Simulator = InstanceType<typeof DeviceClient>;

/** Order that changes no product state: the reader only prints it. */
const display = (
  line1: string,
): Extract<ServerMessage, { type: 'display.message' }> => ({
  v: PROTOCOL_VERSION,
  id: randomUUID(),
  type: 'display.message',
  ts: Math.floor(Date.now() / 1000),
  ref: null,
  payload: { line1, line2: 'GymTime', durationSec: 3 },
});

describe('Device command queue (e2e: ack, idempotency and replay)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  const lines: string[] = [];
  const logger = {
    frame: (direction: string, raw: string) =>
      lines.push(`${direction} ${raw}`),
    state: (text: string) => lines.push(text),
    warn: (text: string) => lines.push(`WARN ${text}`),
  };

  const startApp = async (options?: Parameters<typeof buildInMemoryApp>[0]) => {
    const harness = await buildInMemoryApp(options);
    cleanups.push(() => harness.close());
    return harness;
  };

  const startSimulator = async (harness: Harness): Promise<Simulator> => {
    const device = new DeviceClient(
      {
        url: harness.wsUrl,
        deviceId: DEVICE_ID,
        token: TOKEN,
        fw: 'sim-e2e',
        enroll: {
          mode: 'ok',
          stepMs: 5,
          failReason: 'sim_fail',
          templateBytes: 512,
        },
      },
      logger,
    );
    cleanups.push(() => device.stop());
    device.start();
    await vi.waitFor(() => expect(device.state).toBe('online'));
    return device;
  };

  const deviceStatus = async (harness: Harness) => {
    const res = await harness.http().get('/devices/status').set(harness.auth);
    expect(res.status).toBe(200);
    return res.body as Array<{ deviceId: string; online: boolean }>;
  };

  beforeEach(() => {
    lines.length = 0;
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('queues an order without a connection and delivers it on reconnect with the same id', async () => {
    const harness = await startApp({ devices: { ackTimeoutMs: 60 } });
    const device = await startSimulator(harness);

    device.disconnect();
    await vi.waitFor(async () => {
      expect(await deviceStatus(harness)).toMatchObject([
        { deviceId: DEVICE_ID, online: false },
      ]);
    });

    const message = display('Reconectado');
    const result = await harness.app
      .get(OutboundSender)
      .sendCommand(DEVICE_ID, message);
    expect(result).toBe('queued');
    expect(
      await harness.repositories.commands.findById(message.id),
    ).toMatchObject({ status: 'pending', attempts: 0 });

    device.reconnect();
    await vi.waitFor(() => expect(device.state).toBe('online'));
    await vi.waitFor(
      async () => {
        expect(
          await harness.repositories.commands.findById(message.id),
        ).toMatchObject({ status: 'acked' });
      },
      { timeout: 3000, interval: 10 },
    );

    // The simulator confirmed exactly one delivery, with the original id.
    const delivered = lines.filter((line) =>
      line.includes(`received display.message ${message.id}`),
    );
    expect(delivered).toHaveLength(1);
  });

  it('resends the same id until the device confirms it, without new rows', async () => {
    const harness = await startApp({
      devices: { ackTimeoutMs: 60, maxResends: 3 },
    });
    const raw = await RawDevice.connect({
      url: harness.wsUrl,
      deviceId: DEVICE_ID,
      token: TOKEN,
      autoAck: false,
    });
    cleanups.push(() => raw.close());

    const message = display('Reintento');
    const sent = harness.app
      .get(OutboundSender)
      .sendCommand(DEVICE_ID, message);

    const deliveries = () =>
      raw
        .framesOf('display.message')
        .filter((frame) => frame.id === message.id);
    await vi.waitFor(
      () => expect(deliveries().length).toBeGreaterThanOrEqual(2),
      {
        timeout: 3000,
        interval: 5,
      },
    );
    const [first, second] = deliveries();
    expect(second).toEqual(first);

    raw.ack(message.id);
    expect(await sent).toBe('acked');
    await vi.waitFor(
      async () => {
        expect(
          await harness.repositories.commands.findById(message.id),
        ).toMatchObject({ status: 'acked', attempts: 2 });
      },
      { timeout: 3000, interval: 10 },
    );
    expect(
      await harness.repositories.commands.countUnconfirmed(DEVICE_ID),
    ).toBe(0);
  });

  it('turns sent rows back to pending on restart and delivers the queue on connect', async () => {
    const first = await startApp();
    const pending = display('Pendiente');
    const inFlight = display('En vuelo');
    for (const message of [pending, inFlight]) {
      await first.repositories.commands.create({
        id: message.id,
        deviceId: DEVICE_ID,
        type: message.type,
        payload: message.payload,
        createdAt: new Date(),
      });
    }
    await first.repositories.commands.markSent(inFlight.id, 1);
    await first.close();

    // Same repositories, new process: the gateway resets `sent` on bootstrap.
    const second = await startApp({ repositories: first.repositories });
    expect(
      await second.repositories.commands.findById(inFlight.id),
    ).toMatchObject({ status: 'pending' });

    const device = await startSimulator(second);
    await vi.waitFor(
      async () => {
        for (const message of [pending, inFlight]) {
          expect(
            await second.repositories.commands.findById(message.id),
          ).toMatchObject({ status: 'acked' });
        }
      },
      { timeout: 5000, interval: 10 },
    );
    expect(device.state).toBe('online');
    for (const message of [pending, inFlight]) {
      expect(
        lines.some((line) =>
          line.includes(`received display.message ${message.id}`),
        ),
      ).toBe(true);
    }
  });
});
