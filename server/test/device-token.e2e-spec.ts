import { randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const SHARED = 'device-token-123456';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: SHARED,
  ADMIN_API_KEY: 'admin-key-1234567890',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});
const { buildInMemoryApp } = await import('./support/scenario-app.js');
const { SystemEventsService } =
  await import('../src/common/events/system-events.service.js');

const hello = (token: string, deviceId = 'esp32-01') =>
  JSON.stringify({
    v: 1,
    id: randomUUID(),
    type: 'hello',
    ts: 1_700_000_000,
    ref: null,
    payload: { deviceId, token, fw: '1.0.0' },
  });

/** Opens a connection, says hello and resolves with the first answer and the close code. */
function connect(url: string, token: string) {
  const ws = new WebSocket(url);
  const frames: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const closed = new Promise<number>((resolve) =>
    ws.on('close', (code) => resolve(code)),
  );
  ws.on('message', (data) =>
    frames.push(JSON.parse((data as Buffer).toString())),
  );
  ws.on('open', () => ws.send(hello(token)));
  return { ws, frames, closed };
}

describe('Own token per device (e2e, H11)', () => {
  let h: Awaited<ReturnType<typeof buildInMemoryApp>>;
  beforeEach(async () => {
    h = await buildInMemoryApp();
  });
  afterEach(() => h.close());

  const waitFor = (cond: () => boolean) =>
    vi.waitFor(() => expect(cond()).toBe(true));

  it('registers, connects with the own token, rotates and revokes with immediate effect', async () => {
    const reasons: string[] = [];
    h.app.get(SystemEventsService).events.subscribe((event) => {
      if (event.type === 'device.disconnected') reasons.push(event.data.reason);
    });

    const first = await h
      .http()
      .post('/devices')
      .set(h.auth)
      .send({ deviceId: 'esp32-01' })
      .expect(201);
    const token1 = first.body.token as string;

    // The shared token no longer serves this device.
    const shared = connect(h.wsUrl, SHARED);
    await shared.closed;
    expect(shared.frames[0]?.payload).toMatchObject({
      ok: false,
      error: 'UNAUTHORIZED',
    });

    const live = connect(h.wsUrl, token1);
    await waitFor(() => live.frames.some((f) => f.type === 'hello.ok'));

    const second = await h
      .http()
      .post('/devices/esp32-01/token/rotate')
      .set(h.auth)
      .expect(200);
    expect(await live.closed).toBe(4410);
    await waitFor(() => reasons.includes('token_revoked'));

    const old = connect(h.wsUrl, token1);
    await old.closed;
    expect(old.frames[0]?.payload).toMatchObject({
      ok: false,
      error: 'UNAUTHORIZED',
    });

    const fresh = connect(h.wsUrl, second.body.token as string);
    await waitFor(() => fresh.frames.some((f) => f.type === 'hello.ok'));

    await h
      .http()
      .post('/devices/esp32-01/token/revoke')
      .set(h.auth)
      .expect(200);
    expect(await fresh.closed).toBe(4410);
    const after = connect(h.wsUrl, second.body.token as string);
    await after.closed;
    expect(after.frames[0]?.payload).toMatchObject({
      ok: false,
      error: 'UNAUTHORIZED',
    });
  });

  it('keeps the audit trail without the token', async () => {
    const issued = await h
      .http()
      .post('/devices')
      .set(h.auth)
      .send({ deviceId: 'esp32-01' })
      .expect(201);
    const trail = h.repositories.eventLog;
    const events = await trail.search({ limit: 100 });
    expect(events.map((e) => e.type)).toContain('device.token_registered');
    expect(JSON.stringify(events)).not.toContain(issued.body.token);
  });
});
