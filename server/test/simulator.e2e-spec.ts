import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

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
const { OutboundSender } =
  await import('./../src/devices/outbound-sender.service.js');
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
const { DeviceClient } = await import('@gymtime/simulator');

describe('Simulator against the real gateway (e2e)', () => {
  let app: INestApplication;
  let httpUrl: string;
  let wsUrl: string;
  let client: InstanceType<typeof DeviceClient> | undefined;
  let fingerprints: InstanceType<typeof InMemoryFingerprintsRepository>;
  const lines: string[] = [];
  const logger = {
    frame: (direction: string, raw: string) =>
      lines.push(`${direction} ${raw}`),
    state: (text: string) => lines.push(text),
    warn: (text: string) => lines.push(`WARN ${text}`),
  };

  beforeEach(async () => {
    lines.length = 0;
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
    httpUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/device`;
  });

  afterEach(async () => {
    await client?.stop();
    client = undefined;
    await app.close();
  });

  const start = (token = TOKEN, mode: 'ok' | 'fail' | 'silent' = 'ok') => {
    client = new DeviceClient(
      {
        url: wsUrl,
        deviceId: 'esp32-sim-01',
        token,
        fw: 'sim-e2e',
        enroll: {
          mode,
          stepMs: 10,
          failReason: 'sim_fail',
          templateBytes: 512,
        },
      },
      logger,
    );
    client.start();
    return client;
  };

  it('says hello, shows as online and acks a display.message', async () => {
    const running = start();
    await vi.waitFor(() => expect(running.state).toBe('online'));

    const res = await request(httpUrl)
      .get('/devices/status')
      .set('x-api-key', ADMIN_KEY)
      .expect(200);
    expect(res.body).toMatchObject([
      { deviceId: 'esp32-sim-01', online: true, firmwareVersion: 'sim-e2e' },
    ]);

    const outbound = app.get(OutboundSender);
    const result = await outbound.send('esp32-sim-01', {
      v: 1,
      id: randomUUID(),
      type: 'display.message',
      ts: Math.floor(Date.now() / 1000),
      ref: null,
      payload: { line1: 'Hola', line2: 'GymTime', durationSec: 3 },
    });
    // 'acked' means the simulator's ack reached the gateway and matched.
    expect(result).toBe('acked');
    await vi.waitFor(() =>
      expect(lines.some((l) => l.startsWith('received display.message'))).toBe(
        true,
      ),
    );
  });

  it('is reported as rejected when the token is wrong', async () => {
    start('wrong-token-123456');
    await vi.waitFor(() =>
      expect(lines.some((l) => l.includes('UNAUTHORIZED'))).toBe(true),
    );
    expect(client?.state).not.toBe('online');
  });

  describe('simulated enrollment', () => {
    const createStudent = async (document: string) => {
      const res = await request(httpUrl)
        .post('/students')
        .set('x-api-key', ADMIN_KEY)
        .send({ document, name: 'Ana', consented: true })
        .expect(201);
      return res.body.id as string;
    };
    const enroll = async (studentId: string) => {
      const res = await request(httpUrl)
        .post(`/students/${studentId}/enrollments`)
        .set('x-api-key', ADMIN_KEY)
        .send({})
        .expect(201);
      return res.body.id as string;
    };
    const status = async (enrollmentId: string) => {
      const res = await request(httpUrl)
        .get(`/enrollments/${enrollmentId}`)
        .set('x-api-key', ADMIN_KEY)
        .expect(200);
      return res.body as { status: string; failureReason: string | null };
    };

    it('completes an enrollment without hardware and keeps one fingerprint on re-enrolling', async () => {
      const running = start();
      await vi.waitFor(() => expect(running.state).toBe('online'));
      const studentId = await createStudent('111');
      for (let round = 1; round <= 2; round++) {
        const id = await enroll(studentId);
        await vi.waitFor(async () =>
          expect((await status(id)).status).toBe('done'),
        );
        expect(fingerprints.all()).toHaveLength(1);
      }
      expect(fingerprints.all()[0]?.active).toBe(true);
    });

    it('reports a simulated failure with its reason', async () => {
      const running = start(TOKEN, 'fail');
      await vi.waitFor(() => expect(running.state).toBe('online'));
      const id = await enroll(await createStudent('222'));
      await vi.waitFor(async () =>
        expect(await status(id)).toMatchObject({
          status: 'failed',
          failureReason: 'sim_fail',
        }),
      );
      expect(fingerprints.all()).toHaveLength(0);
    });

    it('expires when the simulator stays silent', async () => {
      const running = start(TOKEN, 'silent');
      await vi.waitFor(() => expect(running.state).toBe('online'));
      const id = await enroll(await createStudent('333'));
      await vi.waitFor(
        async () => expect((await status(id)).status).toBe('expired'),
        { timeout: 5000 },
      );
      expect(fingerprints.all()).toHaveLength(0);
    });
  });
});
