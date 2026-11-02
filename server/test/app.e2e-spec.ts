import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { setupSwagger } from './../src/swagger.js';

const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: 'device-token-123456',
  ADMIN_API_KEY: 'admin-key-1234567890',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

// Environment must be in place before the application modules are loaded.
Object.assign(process.env, testEnv);
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

async function createApp(query: () => Promise<unknown>) {
  const fingerprints = new InMemoryFingerprintsRepository();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue({ $queryRaw: query })
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
    .compile();
  const app = moduleRef.createNestApplication();
  setupSwagger(app);
  await app.init();
  return app;
}

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeEach(() => {
    Object.assign(process.env, testEnv);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('GET /health answers 200 when the database responds', async () => {
    app = await createApp(async () => [1]);
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('GET /health answers 503 when the database fails', async () => {
    app = await createApp(async () => {
      throw new Error('down');
    });
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toMatchObject({ status: 'error', database: 'down' });
  });

  it('publishes Swagger UI and the OpenAPI document', async () => {
    app = await createApp(async () => [1]);
    await request(app.getHttpServer()).get('/docs').redirects(1).expect(200);
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(res.body.info).toMatchObject({
      title: 'GymTime API',
      version: '0.0.1',
    });
    expect(res.body.paths).toHaveProperty('/health');
    expect(res.body.components.securitySchemes['admin-key']).toMatchObject({
      type: 'apiKey',
      in: 'header',
    });
  });
});
