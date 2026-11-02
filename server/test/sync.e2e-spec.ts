import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const TOKEN = 'device-token-123456';
const ADMIN_KEY = 'admin-key-1234567890';
const auth = { 'x-api-key': ADMIN_KEY };
const DEVICE = 'esp32-sim-01';

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
const { SCHEDULES_REPOSITORY } =
  await import('./../src/schedules/domain/schedules.repository.js');
const { INSTANCES_REPOSITORY } =
  await import('./../src/schedules/domain/instances.repository.js');
const { InMemorySchedulesRepository } =
  await import('./../src/schedules/infrastructure/in-memory-schedules.repository.js');
const { InMemoryInstancesRepository } =
  await import('./../src/schedules/infrastructure/in-memory-instances.repository.js');
const { SLOTS_REPOSITORY } =
  await import('./../src/sync/domain/slots.repository.js');
const { ATTENDANCE_REPOSITORY } =
  await import('./../src/attendance/domain/attendance.repository.js');
const { InMemoryAttendanceRepository } =
  await import('./../src/attendance/infrastructure/in-memory-attendance.repository.js');
const { InMemorySlotsRepository } =
  await import('./../src/sync/infrastructure/in-memory-slots.repository.js');
const { SyncService } = await import('./../src/sync/sync.service.js');
const { DeviceClient } = await import('@gymtime/simulator');

describe('Schedules and template sync against the simulator (e2e)', () => {
  let app: INestApplication;
  let http: () => request.Agent;
  let wsUrl: string;
  let client: InstanceType<typeof DeviceClient> | undefined;
  const enrolledTemplates = new Set<string>();
  const output: string[] = [];
  const logger = {
    frame: (direction: string, raw: string) => {
      output.push(`${direction} ${raw}`);
      const msg = JSON.parse(raw) as {
        type: string;
        payload: { template?: string };
      };
      if (direction === 'out' && msg.type === 'enroll.done') {
        enrolledTemplates.add(msg.payload.template as string);
      }
    },
    state: (text: string) => output.push(text),
    warn: (text: string) => output.push(`WARN ${text}`),
  };

  beforeEach(async () => {
    enrolledTemplates.clear();
    output.length = 0;
    const fingerprints = new InMemoryFingerprintsRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(DEVICES_REPOSITORY)
      .useValue(new InMemoryDevicesRepository())
      .overrideProvider(PROCESSED_MESSAGES_REPOSITORY)
      .useValue(new InMemoryProcessedMessagesRepository())
      .overrideProvider(DEVICE_COMMANDS_REPOSITORY)
      .useValue(new InMemoryDeviceCommandsRepository())
      .overrideProvider(ALARM_REPOSITORY)
      .useValue(new InMemoryAlarmRepository())
      .overrideProvider(STUDENTS_REPOSITORY)
      .useValue(new InMemoryStudentsRepository())
      .overrideProvider(FINGERPRINTS_REPOSITORY)
      .useValue(fingerprints)
      .overrideProvider(ENROLLMENTS_REPOSITORY)
      .useValue(new InMemoryEnrollmentsRepository(fingerprints))
      .overrideProvider(SCHEDULES_REPOSITORY)
      .useValue(new InMemorySchedulesRepository())
      .overrideProvider(INSTANCES_REPOSITORY)
      .useValue(new InMemoryInstancesRepository())
      .overrideProvider(SLOTS_REPOSITORY)
      .useValue(new InMemorySlotsRepository())
      .overrideProvider(ATTENDANCE_REPOSITORY)
      .useValue(new InMemoryAttendanceRepository())
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    http = () =>
      request(`http://127.0.0.1:${port}`) as unknown as request.Agent;
    wsUrl = `ws://127.0.0.1:${port}/device`;
  });

  afterEach(async () => {
    await client?.stop();
    client = undefined;
    await app.close();
  });

  const startDevice = async () => {
    client = new DeviceClient(
      {
        url: wsUrl,
        deviceId: DEVICE,
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
    client.start();
    await vi.waitFor(() => expect(client?.state).toBe('online'));
    return client;
  };

  const createEnrolledStudent = async (document: string) => {
    const created = await http()
      .post('/students')
      .set(auth)
      .send({ document, name: `Student ${document}`, consented: true })
      .expect(201);
    const id = created.body.id as string;
    const enrollment = await http()
      .post(`/students/${id}/enrollments`)
      .set(auth)
      .send({})
      .expect(201);
    await vi.waitFor(async () => {
      const res = await http()
        .get(`/enrollments/${enrollment.body.id}`)
        .set(auth);
      expect(res.body.status).toBe('done');
    });
    return id;
  };

  it('requires the API key and answers 409 without a device', async () => {
    await http().post('/sync').expect(401);
    await http().post('/sync').set(auth).expect(409);
  });

  it('loads the reader with the templates and the schedule of a quick test schedule', async () => {
    const device = await startDevice();
    const ana = await createEnrolledStudent('111');
    const luis = await createEnrolledStudent('222');
    const outsider = await createEnrolledStudent('333');
    expect(enrolledTemplates.size).toBe(3);

    const schedule = await http()
      .post('/schedules')
      .set(auth)
      .send({ name: 'Test', endsInMinutes: 3 })
      .expect(201);
    for (const id of [ana, luis]) {
      await http()
        .put(`/schedules/${schedule.body.id}/students/${id}`)
        .set(auth)
        .expect(204);
    }

    const result = await http().post('/sync').set(auth).expect(200);
    expect(result.body).toMatchObject({
      status: 'ok',
      deviceId: DEVICE,
      templates: 2,
      chunks: 1,
      scheduleId: schedule.body.id,
    });

    expect(device.reader.count).toBe(2);
    expect(device.reader.slots).toEqual([1, 2]);
    for (const slot of device.reader.slots) {
      expect(
        enrolledTemplates.has(device.reader.templateAt(slot) as string),
      ).toBe(true);
    }
    expect(device.reader.currentSchedule).toMatchObject({
      scheduleId: schedule.body.id,
    });

    const sync = app.get(SyncService);
    const first = await sync.findStudentBySlot(DEVICE, 1);
    const second = await sync.findStudentBySlot(DEVICE, 2);
    expect([first?.id, second?.id].sort()).toEqual([ana, luis].sort());
    expect([first?.id, second?.id]).not.toContain(outsider);
    expect(await sync.findStudentBySlot(DEVICE, 3)).toBeNull();

    // the shown schedule resolves for an assigned student, with the margins
    const resolved = await http()
      .get('/schedules/resolve')
      .query({ studentId: ana })
      .set(auth)
      .expect(200);
    expect(resolved.body.occurrence).toMatchObject({
      scheduleId: schedule.body.id,
      entryOpen: true,
    });

    // the operator output never carries the templates
    const cli = output.filter(
      (l) => l.startsWith('::: ') || l.startsWith('WARN'),
    );
    for (const template of enrolledTemplates) {
      expect(cli.join('\n')).not.toContain(template);
    }
  });

  it('wipes the reader when the student is removed and nobody remains', async () => {
    const device = await startDevice();
    const ana = await createEnrolledStudent('111');
    const schedule = await http()
      .post('/schedules')
      .set(auth)
      .send({ name: 'Test', endsInMinutes: 5 })
      .expect(201);
    await http()
      .put(`/schedules/${schedule.body.id}/students/${ana}`)
      .set(auth)
      .expect(204);
    await http().post('/sync').set(auth).expect(200);
    expect(device.reader.count).toBe(1);

    await http().delete(`/students/${ana}`).set(auth).expect(200);
    const result = await http().post('/sync').set(auth).expect(200);
    expect(result.body).toMatchObject({
      status: 'ok',
      templates: 0,
      chunks: 1,
    });
    expect(device.reader.count).toBe(0);
  });

  it('syncs by itself when the device connects and when an enrollment ends', async () => {
    const device = await startDevice();
    const ana = await createEnrolledStudent('111');
    const schedule = await http()
      .post('/schedules')
      .set(auth)
      .send({ name: 'Test', endsInMinutes: 5 })
      .expect(201);
    await http()
      .put(`/schedules/${schedule.body.id}/students/${ana}`)
      .set(auth)
      .expect(204);
    // a second enrollment ends: the sync it triggers loads Ana's template
    await createEnrolledStudent('222');
    await vi.waitFor(() => expect(device.reader.count).toBe(1));
    expect(device.reader.currentSchedule).toMatchObject({
      scheduleId: schedule.body.id,
    });
  });
});
