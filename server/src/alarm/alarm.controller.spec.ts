import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { AlarmController } from './alarm.controller.js';
import { AlarmService } from './alarm.service.js';
import { AlarmError } from './domain/alarm.errors.js';

const KEY = 'admin-key-1234567890';

const status = (over: Record<string, unknown> = {}) => ({
  on: false,
  reason: null,
  instanceId: null,
  durationSec: null,
  startedAt: null,
  openSessions: 0,
  ...over,
});

describe('AlarmController (HTTP)', () => {
  let app: INestApplication;
  const auth = { 'x-api-key': KEY };
  const alarm = {
    status: vi.fn(),
    turnOn: vi.fn(),
    off: vi.fn(),
  };
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    vi.clearAllMocks();
    alarm.status.mockResolvedValue(status());
    alarm.turnOn.mockResolvedValue(status());
    alarm.off.mockResolvedValue({
      closedBy: 'cli',
      sessionsClosed: 0,
      status: status(),
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [AlarmController],
      providers: [
        ApiKeyGuard,
        { provide: ConfigService, useValue: { get: () => KEY } },
        { provide: AlarmService, useValue: alarm },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  it('requires the API key on every route', async () => {
    await http().get('/alarm/status').expect(401);
    await http().post('/alarm/on').expect(401);
    await http().post('/alarm/test').expect(401);
    await http().post('/alarm/off').expect(401);
  });

  it('returns the status with ISO dates and open sessions', async () => {
    alarm.status.mockResolvedValue(
      status({
        on: true,
        reason: 'PENDING_EXIT',
        instanceId: 'i1',
        durationSec: null,
        startedAt: new Date('2026-11-02T16:00:00Z'),
        openSessions: 2,
      }),
    );

    const response = await http().get('/alarm/status').set(auth).expect(200);

    expect(response.body).toEqual({
      on: true,
      reason: 'PENDING_EXIT',
      instanceId: 'i1',
      durationSec: null,
      startedAt: '2026-11-02T16:00:00.000Z',
      openSessions: 2,
    });
  });

  it('turns the alarm on and tests with the right reason', async () => {
    const on = await http().post('/alarm/on').set(auth).expect(200);
    expect(on.body).toMatchObject({ on: false });
    expect(alarm.turnOn).toHaveBeenCalledWith('MANUAL');

    await http().post('/alarm/test').set(auth).expect(200);
    expect(alarm.turnOn).toHaveBeenCalledWith('TEST');
  });

  it('silences through the CLI and reports what was closed', async () => {
    alarm.off.mockResolvedValue({
      closedBy: 'cli',
      sessionsClosed: 3,
      status: status({ openSessions: 1 }),
    });

    const response = await http().post('/alarm/off').set(auth).expect(200);

    expect(alarm.off).toHaveBeenCalledWith('cli');
    expect(response.body).toMatchObject({
      closedBy: 'cli',
      sessionsClosed: 3,
      status: { openSessions: 1 },
    });
  });

  it('maps business errors to 409 with the code in the body', async () => {
    alarm.off.mockRejectedValue(new AlarmError('ALARM_NOT_ON'));
    const off = await http().post('/alarm/off').set(auth).expect(409);
    expect(off.body).toMatchObject({ code: 'ALARM_NOT_ON' });

    alarm.turnOn.mockRejectedValue(new AlarmError('NO_DEVICE_ONLINE'));
    const on = await http().post('/alarm/test').set(auth).expect(409);
    expect(on.body).toMatchObject({ code: 'NO_DEVICE_ONLINE' });
  });
});
