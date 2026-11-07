import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

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
const { AppModule } = await import('./../src/app.module.js');
const { LEADER_LOCK, startedLeaderLock } =
  await import('./../src/common/concurrency/leader-lock.js');
const { PrismaService } = await import('./../src/database/prisma.service.js');
const { DEVICES_REPOSITORY } =
  await import('./../src/devices/domain/devices.repository.js');
const { PROCESSED_MESSAGES_REPOSITORY } =
  await import('./../src/devices/domain/processed-messages.repository.js');
const { DEVICE_COMMANDS_REPOSITORY } =
  await import('./../src/devices/domain/device-commands.repository.js');
const { DEVICES_CONFIG, defaultDevicesConfig } =
  await import('./../src/devices/devices.config.js');
const { InMemoryDevicesRepository } =
  await import('./../src/devices/infrastructure/in-memory-devices.repository.js');
const { InMemoryProcessedMessagesRepository } =
  await import('./../src/devices/infrastructure/in-memory-processed-messages.repository.js');
const { InMemoryDeviceCommandsRepository } =
  await import('./../src/devices/infrastructure/in-memory-device-commands.repository.js');
const { FINGERPRINTS_REPOSITORY } =
  await import('./../src/fingerprints/domain/fingerprints.repository.js');
const { InMemoryFingerprintsRepository } =
  await import('./../src/fingerprints/infrastructure/in-memory-fingerprints.repository.js');
const { ENROLLMENTS_REPOSITORY } =
  await import('./../src/fingerprints/domain/enrollments.repository.js');
const { InMemoryEnrollmentsRepository } =
  await import('./../src/fingerprints/infrastructure/in-memory-enrollments.repository.js');
const { SCHEDULES_REPOSITORY } =
  await import('./../src/schedules/domain/schedules.repository.js');
const { InMemorySchedulesRepository } =
  await import('./../src/schedules/infrastructure/in-memory-schedules.repository.js');
const { INSTANCES_REPOSITORY } =
  await import('./../src/schedules/domain/instances.repository.js');
const { InMemoryInstancesRepository } =
  await import('./../src/schedules/infrastructure/in-memory-instances.repository.js');
const { ALARM_REPOSITORY } =
  await import('./../src/alarm/domain/alarm.repository.js');
const { InMemoryAlarmRepository } =
  await import('./../src/alarm/infrastructure/in-memory-alarm.repository.js');
const { MessageProcessor } =
  await import('./../src/devices/message-processor.service.js');

const frame = (
  type: string,
  payload: object,
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    v: 1,
    id: randomUUID(),
    type,
    ts: 1_700_000_000,
    ref: null,
    payload,
    ...extra,
  });
const hello = (token = TOKEN) =>
  frame('hello', { deviceId: 'esp32-1', token, fw: '1.0.0' });

/** Collects incoming frames and the close event of a client. */
function track(ws: WebSocket) {
  const inbox: any[] = [];
  const waiters: Array<() => void> = [];
  const closed = new Promise<number>((resolve) =>
    ws.on('close', (code) => resolve(code)),
  );
  ws.on('message', (data) => {
    inbox.push(JSON.parse((data as Buffer).toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const next = async (): Promise<any> => {
    while (inbox.length === 0) await new Promise<void>((r) => waiters.push(r));
    return inbox.shift();
  };
  return { next, closed, inbox };
}

describe('Device gateway (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let httpUrl: string;
  let processor: InstanceType<typeof MessageProcessor>;
  const clients: WebSocket[] = [];

  async function connect(path = '/device') {
    const ws = new WebSocket(`${url}${path}`);
    clients.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return { ws, ...track(ws) };
  }

  beforeEach(async () => {
    const fingerprints = new InMemoryFingerprintsRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LEADER_LOCK)
      .useValue(startedLeaderLock())
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(DEVICES_REPOSITORY)
      .useValue(new InMemoryDevicesRepository())
      .overrideProvider(PROCESSED_MESSAGES_REPOSITORY)
      .useValue(new InMemoryProcessedMessagesRepository())
      .overrideProvider(DEVICE_COMMANDS_REPOSITORY)
      .useValue(new InMemoryDeviceCommandsRepository())
      .overrideProvider(FINGERPRINTS_REPOSITORY)
      .useValue(fingerprints)
      .overrideProvider(ENROLLMENTS_REPOSITORY)
      .useValue(new InMemoryEnrollmentsRepository(fingerprints))
      .overrideProvider(SCHEDULES_REPOSITORY)
      .useValue(new InMemorySchedulesRepository())
      .overrideProvider(INSTANCES_REPOSITORY)
      .useValue(new InMemoryInstancesRepository())
      .overrideProvider(ALARM_REPOSITORY)
      .useValue(new InMemoryAlarmRepository())
      .overrideProvider(DEVICES_CONFIG)
      .useValue({ ...defaultDevicesConfig, helloTimeoutMs: 300 })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `ws://127.0.0.1:${port}`;
    httpUrl = `http://127.0.0.1:${port}`;
    processor = app.get(MessageProcessor);
  });

  afterEach(async () => {
    clients.splice(0).forEach((ws) => ws.terminate());
    await app.close();
  });

  it('answers hello with hello.ok and exposes the device as online', async () => {
    const { ws, next } = await connect();
    const raw = hello();
    ws.send(raw);
    const reply = await next();
    expect(reply).toMatchObject({
      type: 'hello.ok',
      ref: JSON.parse(raw).id,
      payload: { heartbeatSec: 30 },
    });
    expect(typeof reply.payload.serverTime).toBe('number');

    const res = await request(httpUrl)
      .get('/devices/status')
      .set('x-api-key', ADMIN_KEY)
      .expect(200);
    expect(res.body).toMatchObject([
      { deviceId: 'esp32-1', online: true, firmwareVersion: '1.0.0' },
    ]);
  });

  it('rejects a wrong token with UNAUTHORIZED and closes', async () => {
    const { ws, next, closed } = await connect();
    ws.send(hello('wrong-token-123456'));
    expect(await next()).toMatchObject({
      type: 'ack',
      payload: { ok: false, error: 'UNAUTHORIZED' },
    });
    await closed;
  });

  it('closes a connection that never sends hello', async () => {
    const { closed } = await connect();
    await closed;
  });

  it('answers NOT_AUTHENTICATED before hello', async () => {
    const { ws, next } = await connect();
    ws.send(
      frame('status', { uptime: 1, heap: 1, rssi: -1, fingerprintCount: 0 }),
    );
    expect(await next()).toMatchObject({
      payload: { ok: false, error: 'NOT_AUTHENTICATED' },
    });
  });

  it('acks a message and processes a repeated id only once', async () => {
    const handler = vi.fn();
    processor.registerHandler('status', handler);
    const { ws, next } = await connect();
    ws.send(hello());
    await next();

    const raw = frame('status', {
      uptime: 1,
      heap: 1,
      rssi: -1,
      fingerprintCount: 0,
    });
    ws.send(raw);
    const first = await next();
    ws.send(raw);
    const second = await next();

    expect(first).toMatchObject({
      type: 'ack',
      ref: JSON.parse(raw).id,
      payload: { ok: true },
    });
    expect(second).toEqual(first);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('answers an invalid message with an error ack', async () => {
    const { ws, next } = await connect();
    ws.send(hello());
    await next();
    ws.send(frame('status', { uptime: 'x' }));
    expect(await next()).toMatchObject({
      payload: { ok: false, error: 'INVALID_MESSAGE' },
    });
  });

  it('marks the device offline when the connection closes', async () => {
    const { ws, next, closed } = await connect();
    ws.send(hello());
    await next();
    ws.close();
    await closed;
    await vi.waitFor(async () => {
      const res = await request(httpUrl)
        .get('/devices/status')
        .set('x-api-key', ADMIN_KEY);
      expect(res.body[0].online).toBe(false);
    });
  });

  it('keeps only the newest connection of a device', async () => {
    const first = await connect();
    first.ws.send(hello());
    await first.next();
    const second = await connect();
    second.ws.send(hello());
    await second.next();
    await first.closed;
    const res = await request(httpUrl)
      .get('/devices/status')
      .set('x-api-key', ADMIN_KEY);
    expect(res.body[0].online).toBe(true);
  });

  it('refuses upgrades on other paths', async () => {
    await expect(connect('/other')).rejects.toThrow();
  });

  it('protects GET /devices/status with the API key', async () => {
    await request(httpUrl).get('/devices/status').expect(401);
    await request(httpUrl)
      .get('/devices/status')
      .set('x-api-key', 'wrong')
      .expect(401);
  });
});
