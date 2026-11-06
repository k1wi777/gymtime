import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authTestProviders } from '../auth/testing.js';
import { NoDeviceOnlineError, SyncService } from './sync.service.js';
import { SyncController } from './sync.controller.js';

const KEY = 'admin-key-1234567890';

describe('SyncController (HTTP, R19, R21)', () => {
  let app: INestApplication;
  const syncOnline = vi.fn();

  beforeEach(async () => {
    syncOnline.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        ...authTestProviders(),
        { provide: SyncService, useValue: { syncOnline } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  it('requires the API key', async () => {
    await request(app.getHttpServer()).post('/sync').expect(401);
    expect(syncOnline).not.toHaveBeenCalled();
  });

  it('answers the sync result', async () => {
    const result = { status: 'ok', templates: 3, chunks: 1 };
    syncOnline.mockResolvedValue(result);
    const res = await request(app.getHttpServer())
      .post('/sync')
      .set('x-api-key', KEY)
      .expect(200);
    expect(res.body).toEqual(result);
  });

  it('answers 409 when no device is online', async () => {
    syncOnline.mockRejectedValue(new NoDeviceOnlineError());
    await request(app.getHttpServer())
      .post('/sync')
      .set('x-api-key', KEY)
      .expect(409);
  });
});
