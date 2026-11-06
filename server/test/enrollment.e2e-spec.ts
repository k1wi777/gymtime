import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { EVENT_LOG_REPOSITORY } from '../src/common/audit/event-log.repository.js';
import { InMemoryEventLogRepository } from '../src/common/audit/in-memory-event-log.repository.js';

const TOKEN = 'device-token-123456';
const ADMIN_KEY = 'admin-key-1234567890';
const auth = { 'x-api-key': ADMIN_KEY };

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: TOKEN,
  ADMIN_API_KEY: ADMIN_KEY,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});
const { AppModule } = await import('./../src/app.module.js');
const { PrismaService } = await import('./../src/database/prisma.service.js');
const { DEVICES_REPOSITORY } =
  await import('./../src/devices/domain/devices.repository.js');
const { PROCESSED_MESSAGES_REPOSITORY } =
  await import('./../src/devices/domain/processed-messages.repository.js');
const { DEVICE_COMMANDS_REPOSITORY } =
  await import('./../src/devices/domain/device-commands.repository.js');
const { InMemoryDevicesRepository } =
  await import('./../src/devices/infrastructure/in-memory-devices.repository.js');
const { InMemoryProcessedMessagesRepository } =
  await import('./../src/devices/infrastructure/in-memory-processed-messages.repository.js');
const { InMemoryDeviceCommandsRepository } =
  await import('./../src/devices/infrastructure/in-memory-device-commands.repository.js');
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
const { STUDENTS_REPOSITORY } =
  await import('./../src/students/domain/students.repository.js');
const { InMemoryStudentsRepository } =
  await import('./../src/students/infrastructure/in-memory-students.repository.js');
const { FINGERPRINTS_REPOSITORY } =
  await import('./../src/fingerprints/domain/fingerprints.repository.js');
const { ENROLLMENTS_REPOSITORY } =
  await import('./../src/fingerprints/domain/enrollments.repository.js');
const { InMemoryFingerprintsRepository } =
  await import('./../src/fingerprints/infrastructure/in-memory-fingerprints.repository.js');
const { InMemoryEnrollmentsRepository } =
  await import('./../src/fingerprints/infrastructure/in-memory-enrollments.repository.js');
const { FINGERPRINTS_CONFIG, defaultFingerprintsConfig } =
  await import('./../src/fingerprints/fingerprints.config.js');
const { TemplateCipher } =
  await import('./../src/fingerprints/crypto/template-cipher.service.js');

const frame = (type: string, payload: object, ref: string | null = null) =>
  JSON.stringify({
    v: 1,
    id: randomUUID(),
    type,
    ts: 1_700_000_000,
    ref,
    payload,
  });
const template = (fill: number, size = 512) =>
  Buffer.alloc(size, fill).toString('base64');

/** Minimal test device: hello, then an inbox of server frames. */
async function connectDevice(url: string, clients: WebSocket[]) {
  const ws = new WebSocket(`${url}/device`);
  clients.push(ws);
  const inbox: any[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (data) => {
    inbox.push(JSON.parse((data as Buffer).toString()));
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const next = async (): Promise<any> => {
    while (inbox.length === 0) await new Promise<void>((r) => waiters.push(r));
    return inbox.shift();
  };
  ws.send(frame('hello', { deviceId: 'esp32-1', token: TOKEN, fw: '1.0.0' }));
  await next();
  return { ws, next };
}

describe('Enrollment flow (e2e, ws + REST, in-memory repositories)', () => {
  let app: INestApplication;
  let url: string;
  let httpUrl: string;
  let fingerprints: InstanceType<typeof InMemoryFingerprintsRepository>;
  let cipher: InstanceType<typeof TemplateCipher>;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    fingerprints = new InMemoryFingerprintsRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(DEVICES_REPOSITORY)
      .useValue(new InMemoryDevicesRepository())
      .overrideProvider(PROCESSED_MESSAGES_REPOSITORY)
      .useValue(new InMemoryProcessedMessagesRepository())
      .overrideProvider(DEVICE_COMMANDS_REPOSITORY)
      .useValue(new InMemoryDeviceCommandsRepository())
      .overrideProvider(SCHEDULES_REPOSITORY)
      .useValue(new InMemorySchedulesRepository())
      .overrideProvider(INSTANCES_REPOSITORY)
      .useValue(new InMemoryInstancesRepository())
      .overrideProvider(ALARM_REPOSITORY)
      .useValue(new InMemoryAlarmRepository())
      .overrideProvider(EVENT_LOG_REPOSITORY)
      .useValue(new InMemoryEventLogRepository())
      .overrideProvider(STUDENTS_REPOSITORY)
      .useValue(new InMemoryStudentsRepository())
      .overrideProvider(FINGERPRINTS_REPOSITORY)
      .useValue(fingerprints)
      .overrideProvider(ENROLLMENTS_REPOSITORY)
      .useValue(new InMemoryEnrollmentsRepository(fingerprints))
      .overrideProvider(FINGERPRINTS_CONFIG)
      .useValue({
        ...defaultFingerprintsConfig,
        enrollTimeoutSec: 1,
        ackMarginSec: 0,
        expirySweepMs: 50,
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `ws://127.0.0.1:${port}`;
    httpUrl = `http://127.0.0.1:${port}`;
    cipher = app.get(TemplateCipher);
  });

  afterEach(async () => {
    clients.splice(0).forEach((ws) => ws.terminate());
    await app.close();
  });

  const createStudent = async (document = '100') =>
    (
      await request(httpUrl)
        .post('/students')
        .set(auth)
        .send({ document, name: 'Ana', consented: true })
        .expect(201)
    ).body.id as string;

  /** Starts an enrollment over REST while the device acks enroll.start. */
  async function startEnrollment(
    studentId: string,
    device: Awaited<ReturnType<typeof connectDevice>>,
  ) {
    const pending = request(httpUrl)
      .post(`/students/${studentId}/enrollments`)
      .set(auth)
      .then((res) => res);
    const start = await device.next();
    expect(start).toMatchObject({
      type: 'enroll.start',
      payload: { scratchSlot: 162, timeoutSec: 1 },
    });
    device.ws.send(frame('ack', { ok: true }, start.id));
    const res = await pending;
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  const status = async (id: string) =>
    (await request(httpUrl).get(`/enrollments/${id}`).set(auth).expect(200))
      .body;

  it('enrolls: start, ack, progress, done -> encrypted fingerprint', async () => {
    const device = await connectDevice(url, clients);
    const studentId = await createStudent();
    const id = await startEnrollment(studentId, device);
    expect(await status(id)).toMatchObject({ status: 'in_progress' });

    const progress = frame('enroll.progress', {
      enrollmentId: id,
      step: 'place_again',
    });
    device.ws.send(progress);
    expect(await device.next()).toMatchObject({
      type: 'ack',
      payload: { ok: true },
    });
    expect(await status(id)).toMatchObject({ step: 'place_again' });

    device.ws.send(
      frame('enroll.done', { enrollmentId: id, template: template(7) }),
    );
    expect(await device.next()).toMatchObject({
      type: 'ack',
      payload: { ok: true },
    });
    expect(await status(id)).toMatchObject({ status: 'done' });

    const stored = await fingerprints.findActiveByStudent(studentId);
    expect(stored?.template.toString('base64')).not.toBe(template(7));
    expect(
      cipher
        .decrypt({ data: stored!.template, iv: stored!.iv })
        .equals(Buffer.alloc(512, 7)),
    ).toBe(true);
  });

  it('re-enrolling erases the previous fingerprint', async () => {
    const device = await connectDevice(url, clients);
    const studentId = await createStudent();
    for (const fill of [1, 2]) {
      const id = await startEnrollment(studentId, device);
      device.ws.send(
        frame('enroll.done', { enrollmentId: id, template: template(fill) }),
      );
      await device.next();
    }
    const rows = fingerprints.all();
    expect(rows).toHaveLength(1);
    expect(rows[0].active).toBe(true);
  });

  it('rejects an invalid template: failed, no fingerprint, message still acked', async () => {
    const device = await connectDevice(url, clients);
    const studentId = await createStudent();
    const id = await startEnrollment(studentId, device);
    device.ws.send(
      frame('enroll.done', { enrollmentId: id, template: template(3, 40) }),
    );
    expect(await device.next()).toMatchObject({ payload: { ok: true } });
    expect(await status(id)).toMatchObject({
      status: 'failed',
      failureReason: expect.stringContaining('BAD_SIZE'),
    });
    expect(fingerprints.all()).toHaveLength(0);
  });

  it('records enroll.failed with its reason', async () => {
    const device = await connectDevice(url, clients);
    const id = await startEnrollment(await createStudent(), device);
    device.ws.send(
      frame('enroll.failed', { enrollmentId: id, reason: 'IMAGE_MESS' }),
    );
    await device.next();
    expect(await status(id)).toMatchObject({
      status: 'failed',
      failureReason: 'IMAGE_MESS',
    });
  });

  it('cancelling sends enroll.cancel and later events are ignored', async () => {
    const device = await connectDevice(url, clients);
    const studentId = await createStudent();
    const id = await startEnrollment(studentId, device);
    await request(httpUrl)
      .post(`/enrollments/${id}/cancel`)
      .set(auth)
      .expect(200);
    const cancel = await device.next();
    expect(cancel).toMatchObject({
      type: 'enroll.cancel',
      payload: { enrollmentId: id },
    });
    device.ws.send(frame('ack', { ok: true }, cancel.id));

    device.ws.send(
      frame('enroll.done', { enrollmentId: id, template: template(7) }),
    );
    expect(await device.next()).toMatchObject({ payload: { ok: true } });
    expect(await status(id)).toMatchObject({ status: 'cancelled' });
    expect(fingerprints.all()).toHaveLength(0);
  });

  it('expires without response and tells the device to leave enrollment mode', async () => {
    const device = await connectDevice(url, clients);
    const id = await startEnrollment(await createStudent(), device);
    const cancel = await device.next();
    expect(cancel).toMatchObject({
      type: 'enroll.cancel',
      payload: { enrollmentId: id },
    });
    device.ws.send(frame('ack', { ok: true }, cancel.id));
    expect(await status(id)).toMatchObject({ status: 'expired' });
  });

  it('answers 409 when the device is not connected', async () => {
    const studentId = await createStudent();
    await request(httpUrl)
      .post(`/students/${studentId}/enrollments`)
      .set(auth)
      .expect(409);
  });

  it('deactivating a student removes the fingerprint', async () => {
    const device = await connectDevice(url, clients);
    const studentId = await createStudent();
    const id = await startEnrollment(studentId, device);
    device.ws.send(
      frame('enroll.done', { enrollmentId: id, template: template(7) }),
    );
    await device.next();
    expect(fingerprints.all()).toHaveLength(1);
    await request(httpUrl)
      .delete(`/students/${studentId}`)
      .set(auth)
      .expect(200);
    expect(fingerprints.all()).toHaveLength(0);
  });
});
