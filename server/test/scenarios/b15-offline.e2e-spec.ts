import { randomBytes } from 'node:crypto';

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

const { startScenarioApp, DEVICE_ID, bogotaAt } =
  await import('../support/scenario-app.js');
const { RawDevice } = await import('../support/raw-device.js');

type Harness = Awaited<ReturnType<typeof startScenarioApp>>;

const sec = (time: string) => Math.floor(bogotaAt(time).getTime() / 1000);

/**
 * B15 end to end: the simulator in offline mode loses the network, decides
 * alone with the snapshot, and on reconnecting the server reconciles with the
 * original hours. In-memory repositories and a controlled clock.
 */
describe('B15 — offline mode with the simulator (e2e)', () => {
  let harness: Harness;
  let raw: Awaited<ReturnType<typeof RawDevice.connect>> | undefined;

  beforeEach(async () => {
    harness = await startScenarioApp();
  });

  afterEach(async () => {
    await raw?.close();
    raw = undefined;
    await harness.close();
  });

  const review = async (view = 'pending') =>
    (
      await harness
        .http()
        .get('/offline/review')
        .query({ view })
        .set(harness.auth)
        .expect(200)
    ).body as {
      items: Array<{
        id: string;
        type: string;
        outcome: string;
        reviewReason: string | null;
        actions: string[];
      }>;
      total: number;
    };

  it('reconciles with the original hours, reviews conflicts, ignores a repeated batch and alarms after the end', async () => {
    harness.setNow('09:58');
    await harness.startDevice({
      offline: { clockOffsetSec: 0, stateFile: null },
    });
    // Ana: normal. Luis: has a manual entry on the server meanwhile (conflict).
    // Eva: enters and never leaves (late alarm).
    const ana = await harness.createEnrolledStudent('111', 'Ana');
    const luis = await harness.createEnrolledStudent('222', 'Luis');
    const eva = await harness.createEnrolledStudent('333', 'Eva');
    const scheduleId = await harness.createSchedule({
      name: 'B15',
      start: '10:00',
      end: '11:00',
    });
    for (const id of [ana, luis, eva]) await harness.assign(scheduleId, id);

    await harness.sync();
    const device = harness.device();
    await vi.waitFor(() =>
      expect(device.offlineParts?.engine.snapshot?.roster).toHaveLength(3),
    );
    const slots = {
      ana: await harness.resolveSlot(ana),
      luis: await harness.resolveSlot(luis),
      eva: await harness.resolveSlot(eva),
    };

    // The network is lost.
    device.disconnect();
    await vi.waitFor(() => expect(device.state).toBe('backoff'));

    harness.setNow('10:05');
    device.scan(slots.ana);
    harness.setNow('10:10');
    await harness
      .http()
      .post('/attendance/entry')
      .set(harness.auth)
      .send({ studentId: luis, reason: 'Huella no lee' })
      .expect(201);
    harness.setNow('10:12');
    device.scan(slots.luis);
    harness.setNow('10:20');
    device.scan(slots.eva);
    harness.setNow('10:40');
    device.scan(slots.ana);
    device.scan(99);
    expect(device.queued).toBe(5);
    // Nothing reached the server by deciding offline.
    expect(await harness.sessions()).toHaveLength(1);

    // The end of the schedule passes with Eva (and Luis) inside.
    harness.setNow('11:02');
    device.offlineParts?.engine.tick(sec('11:02'));
    device.reconnect();
    await vi.waitFor(() => expect(device.queued).toBe(0));

    const sessions = (await harness.sessions()) as Array<{
      student: { id: string };
      enteredAt: string;
      exitedAt: string | null;
      entrySource: string;
      exitSource: string | null;
    }>;
    const of = (id: string) => sessions.find((s) => s.student.id === id)!;
    // Original hours, not the reconnection time.
    expect(of(ana).enteredAt).toBe(bogotaAt('10:05').toISOString());
    expect(of(ana).exitedAt).toBe(bogotaAt('10:40').toISOString());
    expect(of(ana)).toMatchObject({
      entrySource: 'offline',
      exitSource: 'offline',
    });
    expect(of(eva).enteredAt).toBe(bogotaAt('10:20').toISOString());
    expect(of(eva).exitedAt).toBeNull();
    expect(sessions).toHaveLength(3);

    // Luis' second entry contradicts the server: waits for a person.
    const pending = await review();
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0]).toMatchObject({
      type: 'entry',
      reviewReason: 'DUPLICATE_ENTRY',
    });
    expect(pending.items[0]!.actions).toEqual(['corregir', 'descartar']);
    const count = await harness
      .http()
      .get('/offline/review/count')
      .set(harness.auth)
      .expect(200);
    expect(count.body).toEqual({ pending: 1 });

    // The siren sounds in the server for Eva and Luis, not for the local alarm.
    expect(await harness.alarmStatus()).toMatchObject({ on: true });

    // The same batch again (retry after a lost ack): same effect, same ack.
    const batch = harness
      .sentFrames()
      .find((f) => f.type === 'offline.events') as {
      payload: Record<string, unknown>;
    };
    await harness.stopDevice();
    raw = await RawDevice.connect({
      url: harness.wsUrl,
      deviceId: DEVICE_ID,
      token: TOKEN,
    });
    const id = raw.send('offline.events', batch.payload as never);
    const ack = await raw.waitFor('ack', (m) => m.ref === id);
    expect(ack.payload).toMatchObject({ ok: true });
    expect(await harness.sessions()).toHaveLength(3);
    expect((await review()).total).toBe(1);

    // The person discards the conflict with a reason.
    await harness
      .http()
      .post(`/offline/review/${pending.items[0]!.id}/resolve`)
      .set(harness.auth)
      .send({ action: 'descartar', reason: 'Ya estaba dentro' })
      .expect(200);
    expect((await review()).total).toBe(0);
    expect((await review('discarded')).total).toBe(1);
  });

  it('a hello without capabilities gets no snapshot and behaves as v0', async () => {
    await harness.startDevice();
    const ana = await harness.createEnrolledStudent('111', 'Ana');
    const scheduleId = await harness.createSchedule({
      name: 'B15',
      start: '10:00',
      end: '11:00',
    });
    await harness.assign(scheduleId, ana);
    harness.setNow('10:05');
    await harness.sync();
    await new Promise((r) => setTimeout(r, 200));
    expect(harness.framesOf('offline.snapshot')).toHaveLength(0);
    expect(harness.framesOf('hello.ok')[0]?.payload).not.toHaveProperty(
      'capabilities',
    );
  });
});
