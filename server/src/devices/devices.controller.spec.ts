import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authTestProviders } from '../auth/testing.js';
import { auditTestProviders } from '../common/audit/testing.js';
import { ConfigService } from '@nestjs/config';
import { CLOCK, systemClock } from '../common/time/clock.js';
import { ConnectionRegistry } from './connection-registry.js';
import { DeviceTokensService } from './device-tokens.service.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';
import { DisplayService } from './display.service.js';
import { DEVICE_COMMANDS_REPOSITORY } from './domain/device-commands.repository.js';
import { DEVICES_REPOSITORY } from './domain/devices.repository.js';
import { InMemoryDeviceCommandsRepository } from './infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';
import { OutboundSender } from './outbound-sender.service.js';

const KEY = 'admin-key-1234567890';
const SHARED = 'shared-device-token-123';

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
        ...authTestProviders(),
        ...auditTestProviders,
        DevicesService,
        DisplayService,
        DeviceTokensService,
        ConnectionRegistry,
        { provide: CLOCK, useValue: systemClock },
        { provide: ConfigService, useValue: { get: () => SHARED } },
        { provide: DEVICES_REPOSITORY, useClass: InMemoryDevicesRepository },
        {
          provide: DEVICE_COMMANDS_REPOSITORY,
          useClass: InMemoryDeviceCommandsRepository,
        },
        { provide: OutboundSender, useValue: { sendCommand } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    devices = moduleRef.get(DevicesService);
  });

  afterEach(() => app.close());

  it('requires the API key', async () => {
    await http().get('/devices/status').expect(401);
    await http().post('/devices/messages').send({ title: 'x' }).expect(401);
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
        tokenStatus: 'legacy',
        offlineSince: null,
        offlineAlert: false,
        alertThresholdMinutes: 5,
      },
    ]);
  });

  describe('own token (H11)', () => {
    it('registers once, shows the token once and never caches it', async () => {
      const res = await http()
        .post('/devices')
        .set(auth)
        .send({ deviceId: 'esp32-01' })
        .expect(201);
      expect(res.body.token).toMatch(/^gt_dev_/);
      expect(res.headers['cache-control']).toBe('no-store');
      await http()
        .post('/devices')
        .set(auth)
        .send({ deviceId: 'esp32-01' })
        .expect(409);
      const status = await http().get('/devices/status').set(auth).expect(200);
      expect(status.body[0]).toMatchObject({
        deviceId: 'esp32-01',
        tokenStatus: 'own',
      });
      expect(JSON.stringify(status.body)).not.toContain(res.body.token);
    });

    it('rotates and revokes; unknown devices and bad ids are refused', async () => {
      await http()
        .post('/devices')
        .set(auth)
        .send({ deviceId: 'd1' })
        .expect(201);
      const rotated = await http()
        .post('/devices/d1/token/rotate')
        .set(auth)
        .expect(200);
      expect(rotated.body.token).toMatch(/^gt_dev_/);
      expect(rotated.headers['cache-control']).toBe('no-store');
      const revoked = await http()
        .post('/devices/d1/token/revoke')
        .set(auth)
        .expect(200);
      expect(revoked.body).toEqual({ deviceId: 'd1', tokenStatus: 'revoked' });
      const status = await http().get('/devices/status').set(auth).expect(200);
      expect(status.body[0].tokenStatus).toBe('revoked');
      await http().post('/devices/nope/token/rotate').set(auth).expect(404);
      await http().post('/devices/nope/token/revoke').set(auth).expect(404);
      await http().post('/devices/bad id!/token/rotate').set(auth).expect(400);
      await http()
        .post('/devices')
        .set(auth)
        .send({ deviceId: '' })
        .expect(400);
    });
  });

  describe('POST /devices/messages (R1, R3, R4)', () => {
    it('sends the order and answers commandId, deviceId and status', async () => {
      await devices.markOnline('d1', '2.0.0');
      const res = await http()
        .post('/devices/messages')
        .set(auth)
        .send({
          title: 'Atención',
          subtitle: 'mañana',
          tone: 'warning',
          durationSec: 5,
        })
        .expect(200);
      expect(res.body).toMatchObject({ deviceId: 'd1', status: 'acked' });
      expect(res.body.commandId).toEqual(expect.any(String));
      expect(sendCommand).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({
          type: 'display.message',
          id: res.body.commandId,
          payload: {
            title: 'Atención',
            subtitle: 'mañana',
            tone: 'warning',
            line1: 'Atención',
            line2: 'mañana',
            color: 'orange',
            durationSec: 5,
          },
        }),
        expect.anything(),
      );
    });

    it('still accepts line1/line2 as aliases and title wins (R9)', async () => {
      await devices.markOnline('d1', '2.0.0');
      await http()
        .post('/devices/messages')
        .set(auth)
        .send({ line1: 'Viejo', line2: 'alias' })
        .expect(200);
      await http()
        .post('/devices/messages')
        .set(auth)
        .send({ title: 'Nuevo', line1: 'Viejo' })
        .expect(200);
      expect(sendCommand.mock.calls[0][1].payload).toMatchObject({
        title: 'Viejo',
        subtitle: 'alias',
        tone: 'info',
      });
      expect(sendCommand.mock.calls[1][1].payload).toMatchObject({
        title: 'Nuevo',
      });
    });

    it('reports a queued order as 200 with status queued', async () => {
      await devices.ensureDevice('d1');
      sendCommand.mockResolvedValue('queued');
      const res = await http()
        .post('/devices/messages')
        .set(auth)
        .send({ title: 'Hola' })
        .expect(200);
      expect(res.body.status).toBe('queued');
    });

    it('rejects an invalid text with 400 naming the field and the limit', async () => {
      await devices.markOnline('d1', '2.0.0');
      const res = await http()
        .post('/devices/messages')
        .set(auth)
        .send({ title: 'ok', subtitle: 'x'.repeat(81) })
        .expect(400);
      expect(res.body.message).toContain(
        'el subtítulo tiene 81 caracteres; máximo 80',
      );
      expect(res.body.issues).toEqual([
        expect.objectContaining({ field: 'subtitle', limit: 80 }),
      ]);
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('rejects a bad body and an out-of-range duration with 400', async () => {
      await devices.markOnline('d1', '2.0.0');
      for (const body of [
        {},
        { title: '' },
        { subtitle: 'sin título' },
        { title: 'a', extra: true },
        { title: 'a', tone: 'purple' },
        { title: 'a', durationSec: 0 },
        { title: 'a', durationSec: 61 },
        { title: 'a', durationSec: 1.5 },
      ]) {
        await http().post('/devices/messages').set(auth).send(body).expect(400);
      }
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('answers 404 NO_DEVICE when no device is known', async () => {
      const res = await http()
        .post('/devices/messages')
        .set(auth)
        .send({ title: 'Hola' })
        .expect(404);
      expect(res.body.code).toBe('NO_DEVICE');
    });
  });
});
