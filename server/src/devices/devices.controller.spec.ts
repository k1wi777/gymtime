import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { auditTestProviders } from '../common/audit/testing.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';
import { DisplayService } from './display.service.js';
import { DEVICE_COMMANDS_REPOSITORY } from './domain/device-commands.repository.js';
import { DEVICES_REPOSITORY } from './domain/devices.repository.js';
import { InMemoryDeviceCommandsRepository } from './infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';
import { OutboundSender } from './outbound-sender.service.js';

const KEY = 'admin-key-1234567890';

describe('DevicesController (HTTP)', () => {
  let app: INestApplication;
  let devices: DevicesService;
  const sendCommand = vi.fn();
  const http = () => request(app.getHttpServer());
  const auth = { 'x-api-key': KEY };

  beforeEach(async () => {
    sendCommand.mockReset().mockResolvedValue('acked');
    const moduleRef = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [
        ...auditTestProviders,
        DevicesService,
        DisplayService,
        ApiKeyGuard,
        { provide: DEVICES_REPOSITORY, useClass: InMemoryDevicesRepository },
        {
          provide: DEVICE_COMMANDS_REPOSITORY,
          useClass: InMemoryDeviceCommandsRepository,
        },
        { provide: OutboundSender, useValue: { sendCommand } },
        { provide: ConfigService, useValue: { get: () => KEY } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    devices = moduleRef.get(DevicesService);
  });

  afterEach(() => app.close());

  it('requires the API key', async () => {
    await http().get('/devices/status').expect(401);
    await http().post('/devices/messages').send({ line1: 'x' }).expect(401);
  });

  it('returns the status of every device', async () => {
    await devices.markOnline('d1', '2.0.0', new Date('2026-01-01T00:00:00Z'));
    const res = await http().get('/devices/status').set(auth).expect(200);
    expect(res.body).toEqual([
      {
        deviceId: 'd1',
        online: true,
        lastConnectedAt: '2026-01-01T00:00:00.000Z',
        firmwareVersion: '2.0.0',
        pendingCommands: 0,
      },
    ]);
  });

  describe('POST /devices/messages (R1, R3, R4)', () => {
    it('sends the order and answers commandId, deviceId and status', async () => {
      await devices.markOnline('d1', '2.0.0');
      const res = await http()
        .post('/devices/messages')
        .set(auth)
        .send({ line1: 'Atención', line2: 'mañana', durationSec: 5 })
        .expect(200);
      expect(res.body).toMatchObject({ deviceId: 'd1', status: 'acked' });
      expect(res.body.commandId).toEqual(expect.any(String));
      expect(sendCommand).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({
          type: 'display.message',
          id: res.body.commandId,
          payload: { line1: 'Atencion', line2: 'manana', durationSec: 5 },
        }),
        expect.anything(),
      );
    });

    it('reports a queued order as 200 with status queued', async () => {
      await devices.ensureDevice('d1');
      sendCommand.mockResolvedValue('queued');
      const res = await http()
        .post('/devices/messages')
        .set(auth)
        .send({ line1: 'Hola' })
        .expect(200);
      expect(res.body.status).toBe('queued');
    });

    it('rejects an invalid text with 400 naming the line and the limit', async () => {
      await devices.markOnline('d1', '2.0.0');
      const res = await http()
        .post('/devices/messages')
        .set(auth)
        .send({ line1: 'ok', line2: 'x'.repeat(17) })
        .expect(400);
      expect(res.body.message).toContain(
        'la línea 2 tiene 17 caracteres; máximo 16',
      );
      expect(res.body.issues).toEqual([
        expect.objectContaining({ line: 2, limit: 16 }),
      ]);
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('rejects a bad body and an out-of-range duration with 400', async () => {
      await devices.markOnline('d1', '2.0.0');
      for (const body of [
        {},
        { line1: '' },
        { line1: 'a', extra: true },
        { line1: 'a', durationSec: 0 },
        { line1: 'a', durationSec: 61 },
        { line1: 'a', durationSec: 1.5 },
      ]) {
        await http().post('/devices/messages').set(auth).send(body).expect(400);
      }
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('answers 404 NO_DEVICE when no device is known', async () => {
      const res = await http()
        .post('/devices/messages')
        .set(auth)
        .send({ line1: 'Hola' })
        .expect(404);
      expect(res.body.code).toBe('NO_DEVICE');
    });
  });
});
