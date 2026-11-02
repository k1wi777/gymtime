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
const { InMemoryDevicesRepository } =
  await import('./../src/devices/infrastructure/in-memory-devices.repository.js');
const { InMemoryProcessedMessagesRepository } =
  await import('./../src/devices/infrastructure/in-memory-processed-messages.repository.js');
const { OutboundSender } =
  await import('./../src/devices/outbound-sender.service.js');
const { DeviceClient } = await import('@gymtime/simulator');

describe('Simulator against the real gateway (e2e)', () => {
  let app: INestApplication;
  let httpUrl: string;
  let wsUrl: string;
  let client: InstanceType<typeof DeviceClient> | undefined;
  const lines: string[] = [];
  const logger = {
    frame: (direction: string, raw: string) =>
      lines.push(`${direction} ${raw}`),
    state: (text: string) => lines.push(text),
    warn: (text: string) => lines.push(`WARN ${text}`),
  };

  beforeEach(async () => {
    lines.length = 0;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(DEVICES_REPOSITORY)
      .useValue(new InMemoryDevicesRepository())
      .overrideProvider(PROCESSED_MESSAGES_REPOSITORY)
      .useValue(new InMemoryProcessedMessagesRepository())
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

  const start = (token = TOKEN) => {
    client = new DeviceClient(
      { url: wsUrl, deviceId: 'esp32-sim-01', token, fw: 'sim-e2e' },
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
});
