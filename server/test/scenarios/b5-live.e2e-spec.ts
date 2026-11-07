import { randomBytes } from 'node:crypto';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: 'device-token-123456',
  ADMIN_API_KEY: 'admin-key-1234567890',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

const { startScenarioApp } = await import('../support/scenario-app.js');

type Harness = Awaited<ReturnType<typeof startScenarioApp>>;

/**
 * B5, server side: while a client keeps the event stream open (what the panel
 * does), the simulator scans and the stream delivers the change with no
 * reload. The browser half lives in `web/tests/e2e/ahora.spec.ts` (V12).
 */
describe('B5 — live panel while the simulator scans (e2e)', () => {
  let harness: Harness;
  const controller = new AbortController();

  beforeEach(async () => {
    harness = await startScenarioApp();
  });

  afterEach(async () => {
    controller.abort();
    await harness.close();
  });

  it('B5 — the event stream delivers the entry and the exit without reloading', async () => {
    await harness.startDevice();
    const ana = await harness.createEnrolledStudent('111', 'Ana');
    const scheduleId = await harness.createSchedule({
      name: 'B5',
      start: '10:00',
      end: '11:00',
    });
    await harness.assign(scheduleId, ana);
    harness.setNow('10:30');
    await harness.sync();
    const slot = await harness.resolveSlot(ana);

    const res = await fetch(`${harness.httpUrl}/events`, {
      headers: harness.auth,
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const until = async (needle: string) => {
      const deadline = Date.now() + 5000;
      while (!received.includes(needle)) {
        if (Date.now() > deadline) throw new Error(`no ${needle} in stream`);
        const chunk = await reader.read();
        if (chunk.done) throw new Error('stream closed');
        received += decoder.decode(chunk.value);
      }
    };

    harness.device().scan(slot);
    await until('"result":"entry"');
    expect(await harness.openSessions()).toHaveLength(1);

    harness.device().scan(slot);
    await until('"result":"exit"');
    expect(await harness.openSessions()).toHaveLength(0);
    expect(received).toContain('event: scan');
  });
});
