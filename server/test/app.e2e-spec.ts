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

async function createApp(query: () => Promise<unknown>) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue({ $queryRaw: query })
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
