import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

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

const { buildInMemoryApp } = await import('./support/scenario-app.js');

const hello = (deviceId: string) =>
  JSON.stringify({
    v: 1,
    id: '00000001-1111-4222-8333-000000000001',
    type: 'hello',
    ts: 1760000000,
    ref: null,
    payload: { deviceId, token: TOKEN, fw: '1' },
  });

describe('Orderly shutdown (R24)', () => {
  it('closes the readers and finishes in seconds with a reader and a live stream open', async () => {
    const h = await buildInMemoryApp();
    const device = new WebSocket(h.wsUrl);
    await new Promise((resolve) => device.once('open', resolve));
    const welcome = new Promise((resolve) => device.once('message', resolve));
    device.send(hello('esp32-shutdown'));
    await welcome;
    const controller = new AbortController();
    const stream = await fetch(`${h.httpUrl}/events`, {
      headers: h.auth,
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    const closedWith = new Promise<number>((resolve) =>
      device.once('close', (code) => resolve(code)),
    );

    const startedAt = Date.now();
    await h.close();
    const elapsed = Date.now() - startedAt;

    expect(await closedWith).toBe(1001);
    expect(elapsed).toBeLessThan(3000);
    controller.abort();
  });

  it('terminates a reader that never answers the close handshake', async () => {
    const h = await buildInMemoryApp();
    // A client whose socket never reads: it cannot complete the handshake.
    const raw = new WebSocket(h.wsUrl);
    await new Promise((resolve) => raw.once('open', resolve));
    raw.pause();
    raw.send(hello('esp32-mute'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const startedAt = Date.now();
    await h.close();

    expect(Date.now() - startedAt).toBeLessThan(3000);
    raw.terminate();
  });
});
