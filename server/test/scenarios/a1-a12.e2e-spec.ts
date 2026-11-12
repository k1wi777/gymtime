import { randomBytes, randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION, type ServerMessage } from '@gymtime/shared';

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

const { startScenarioApp, DEVICE_ID } =
  await import('../support/scenario-app.js');
const { RawDevice } = await import('../support/raw-device.js');
const { OutboundSender } =
  await import('../../src/devices/outbound-sender.service.js');

type Harness = Awaited<ReturnType<typeof startScenarioApp>>;
type Raw = Awaited<ReturnType<typeof RawDevice.connect>>;

/** Order that changes no product state: the reader only prints it. */
const display = (
  title: string,
): Extract<ServerMessage, { type: 'display.message' }> => ({
  v: PROTOCOL_VERSION,
  id: randomUUID(),
  type: 'display.message',
  ts: Math.floor(Date.now() / 1000),
  ref: null,
  payload: {
    title,
    subtitle: 'GymTime',
    tone: 'info',
    line1: title,
    line2: 'GymTime',
    color: 'white',
    durationSec: 3,
  },
});

/**
 * Scenarios A1–A12 of the backlog end to end: the real simulator against the
 * real gateway, in-memory repositories and a controlled clock. No PostgreSQL
 * and no hardware.
 */
describe('A1–A12 scenarios with the simulator (e2e)', () => {
  let harness: Harness;
  let raw: Raw | undefined;

  beforeEach(async () => {
    harness = await startScenarioApp();
  });

  afterEach(async () => {
    await raw?.close();
    raw = undefined;
    await harness.close();
  });

  const connectRaw = async (): Promise<Raw> => {
    raw = await RawDevice.connect({
      url: harness.wsUrl,
      deviceId: DEVICE_ID,
      token: TOKEN,
    });
    return raw;
  };

  it('A1 — completes an enrollment and leaves the template ready to sync', async () => {
    const ana = await harness.createStudent('111', 'Ana');
    const scheduleId = await harness.createSchedule({
      name: 'A',
      start: '10:00',
      end: '11:00',
    });
    await harness.assign(scheduleId, ana);
    await harness.startDevice();
    harness.setNow('10:05');

    await harness.enroll(ana);

    const stored = harness.repositories.fingerprints.all();
    expect(stored).toHaveLength(1);
    const [fingerprint] = stored;
    expect(fingerprint.active).toBe(true);
    expect(fingerprint.iv).toHaveLength(12);
    const done = harness
      .sentFrames()
      .find((frame) => frame.type === 'enroll.done');
    if (!done) throw new Error('the simulator sent no enroll.done');
    const plaintext = (done.payload as { template: string }).template;
    const plain = Buffer.from(plaintext, 'base64');
    expect(plain).toHaveLength(512);
    // Stored encrypted: neither the bytes nor their base64 appear in the row.
    expect(fingerprint.template.equals(plain)).toBe(false);
    expect(fingerprint.template.toString('base64')).not.toBe(plaintext);

    const result = await harness.sync();
    expect(result).toMatchObject({ status: 'ok', templates: 1 });
    const slot = await harness.resolveSlot(ana);
    expect(harness.device().reader.templateAt(slot)).toBe(plaintext);
    // An enrollment is not attendance.
    expect(await harness.sessions()).toHaveLength(0);
  });

  it('A2/A3 — records the entry and then the exit of the same student', async () => {
    await harness.startDevice();
    const ana = await harness.createEnrolledStudent('111', 'Ana');
    const scheduleId = await harness.createSchedule({
      name: 'A',
      start: '10:00',
      end: '11:00',
    });
    await harness.assign(scheduleId, ana);
    harness.setNow('10:30');

    expect(await harness.sync()).toMatchObject({ status: 'ok', templates: 1 });
    const slot = await harness.resolveSlot(ana);

    harness.device().scan(slot);
    const entry = await harness.waitForFrame(
      'scan.result',
      (message) => message.payload.result === 'entry',
    );
    expect(entry.payload).toMatchObject({ studentName: 'Ana', reason: null });
    expect(entry.payload.display).toEqual({
      title: 'Ana',
      subtitle: 'Entrada registrada',
      tone: 'success',
      line1: 'Ana',
      line2: 'Entrada registrada',
      color: 'green',
    });
    const [open] = await harness.openSessions();
    expect(open.student).toMatchObject({ id: ana, name: 'Ana' });
    expect(open.instance).toMatchObject({ scheduleId });

    harness.device().scan(slot);
    const exit = await harness.waitForFrame(
      'scan.result',
      (message) => message.payload.result === 'exit',
    );
    expect(exit.payload.display).toMatchObject({
      title: 'Ana',
      subtitle: 'Salida registrada',
      tone: 'success',
    });
    expect(await harness.openSessions()).toHaveLength(0);
    expect(await harness.sessions()).toMatchObject([
      { status: 'cerrada', exitSource: 'device', student: { id: ana } },
    ]);
  });

  it('A4 — answers an unknown fingerprint without opening a session', async () => {
    raw = await connectRaw();

    const scanId = raw.send('fingerprint.unknown', {});

    const ack = await raw.waitFor('ack', (message) => message.ref === scanId);
    expect(ack.payload).toEqual({ ok: true });
    const result = await raw.waitFor(
      'scan.result',
      (message) => message.ref === scanId,
    );
    expect(result.payload).toMatchObject({
      result: 'unknown',
      studentName: null,
      reason: null,
    });
    expect(result.payload.display).toEqual({
      title: 'Huella no reconocida',
      subtitle: 'Intente de nuevo',
      tone: 'error',
      line1: 'Huella no reconocida',
      line2: 'Intente de nuevo',
      color: 'red',
    });
    expect(await harness.sessions()).toHaveLength(0);
  });

  it('A5 — denies a student that is no longer in the active schedule', async () => {
    await harness.startDevice();
    const ana = await harness.createEnrolledStudent('111', 'Ana');
    const luis = await harness.createEnrolledStudent('222', 'Luis');
    const scheduleId = await harness.createSchedule({
      name: 'A',
      start: '10:00',
      end: '11:00',
    });
    await harness.assign(scheduleId, ana);
    await harness.assign(scheduleId, luis);
    harness.setNow('10:30');

    expect(await harness.sync()).toMatchObject({ status: 'ok', templates: 2 });
    // The reader still holds Luis's template: the server must reject the scan.
    const luisSlot = await harness.resolveSlot(luis);
    await harness.unassign(scheduleId, luis);

    harness.device().scan(luisSlot);
    const denied = await harness.waitForFrame(
      'scan.result',
      (message) => message.payload.result === 'denied',
    );
    expect(denied.payload).toMatchObject({
      studentName: 'Luis',
      reason: 'NOT_IN_SCHEDULE',
    });
    expect(denied.payload.display).toMatchObject({
      title: 'Luis',
      subtitle: 'No es su horario',
      tone: 'error',
    });
    expect(await harness.sessions()).toHaveLength(0);
  });

  it('A6 — denies a scan before any schedule is active', async () => {
    await harness.startDevice();
    const ana = await harness.createEnrolledStudent('111', 'Ana');
    const scheduleId = await harness.createSchedule({
      name: 'A',
      start: '10:00',
      end: '11:00',
    });
    await harness.assign(scheduleId, ana);
    // The entry window of the 10:00 schedule opens at 09:50.
    harness.setNow('09:46');

    expect(await harness.sync()).toMatchObject({ status: 'ok', templates: 1 });
    const slot = await harness.resolveSlot(ana);

    harness.device().scan(slot);
    const denied = await harness.waitForFrame(
      'scan.result',
      (message) => message.payload.result === 'denied',
    );
    expect(denied.payload).toMatchObject({ reason: 'NO_ACTIVE_SCHEDULE' });
    expect(await harness.sessions()).toHaveLength(0);
  });

  it('A7/A8 — keeps the siren on at the end and clears it when the last one leaves', async () => {
    await harness.startDevice();
    const ana = await harness.createEnrolledStudent('111', 'Ana');
    const scheduleId = await harness.createSchedule({
      name: 'A',
      start: '10:00',
      end: '11:00',
    });
    await harness.assign(scheduleId, ana);
    harness.setNow('10:30');

    expect(await harness.sync()).toMatchObject({ status: 'ok' });
    const slot = await harness.resolveSlot(ana);
    harness.device().scan(slot);
    await harness.waitForFrame(
      'scan.result',
      (message) => message.payload.result === 'entry',
    );

    harness.setNow('11:00');
    const alarmOn = await harness.waitForFrame(
      'alarm.set',
      (message) => message.payload.on,
    );
    expect(alarmOn.payload).toEqual({
      on: true,
      durationSec: null,
      reason: 'PENDING_EXIT',
    });
    expect(harness.device().alarm.current).toMatchObject({
      on: true,
      reason: 'PENDING_EXIT',
      durationSec: null,
    });

    harness.setNow('11:01');
    harness.device().scan(slot);
    await harness.waitForFrame(
      'scan.result',
      (message) => message.payload.result === 'exit',
    );
    const alarmOff = await harness.waitForFrame(
      'alarm.set',
      (message) => !message.payload.on,
    );
    expect(alarmOff.payload).toEqual({
      on: false,
      durationSec: null,
      reason: 'CLEARED',
    });
    expect(harness.device().alarm.current).toMatchObject({ on: false });
    expect(await harness.alarmStatus()).toMatchObject({
      on: false,
      openSessions: 0,
    });
    expect(await harness.sessions()).toMatchObject([{ status: 'cerrada' }]);
  });

  /** Two students inside when the schedule ends, to silence it by hand. */
  const alarmedWithTwo = async () => {
    await harness.startDevice();
    const ana = await harness.createEnrolledStudent('111', 'Ana');
    const luis = await harness.createEnrolledStudent('222', 'Luis');
    const scheduleId = await harness.createSchedule({
      name: 'A',
      start: '10:00',
      end: '11:00',
    });
    await harness.assign(scheduleId, ana);
    await harness.assign(scheduleId, luis);
    harness.setNow('10:30');

    expect(await harness.sync()).toMatchObject({ status: 'ok', templates: 2 });
    for (const studentId of [ana, luis]) {
      harness.device().scan(await harness.resolveSlot(studentId));
    }
    await vi.waitFor(
      async () => expect(await harness.openSessions()).toHaveLength(2),
      { timeout: 3000, interval: 10 },
    );

    harness.setNow('11:00');
    await harness.waitForFrame(
      'alarm.set',
      (message) => message.payload.reason === 'PENDING_EXIT',
    );
  };

  it('A9 — the button silences the siren and marks the sessions no_registrada', async () => {
    await alarmedWithTwo();

    harness.device().pressButton();

    const cleared = await harness.waitForFrame(
      'alarm.set',
      (message) => message.payload.reason === 'CLEARED',
    );
    expect(cleared.payload.on).toBe(false);
    expect(harness.device().alarm.current).toMatchObject({ on: false });
    const rows = await harness.sessions({ status: 'no_registrada' });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.manualReason).toBe('alarm_off_button');
    expect(await harness.alarmStatus()).toMatchObject({ on: false });
  });

  it('A9 — the CLI silences the siren and marks the sessions no_registrada', async () => {
    await alarmedWithTwo();

    const res = await harness
      .http()
      .post('/alarm/off')
      .set(harness.auth)
      .expect(200);

    expect(res.body).toMatchObject({ closedBy: 'cli', sessionsClosed: 2 });
    const rows = await harness.sessions({ status: 'no_registrada' });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.manualReason).toBe('alarm_off_cli');
    expect(harness.device().alarm.current).toMatchObject({ on: false });
  });

  it('A10 — delivers the queue on reconnect and does not process a duplicate twice', async () => {
    await harness.startDevice();
    const ana = await harness.createEnrolledStudent('111', 'Ana');
    const scheduleId = await harness.createSchedule({
      name: 'A',
      start: '10:00',
      end: '11:00',
    });
    await harness.assign(scheduleId, ana);
    harness.setNow('10:30');
    expect(await harness.sync()).toMatchObject({ status: 'ok', templates: 1 });
    const slot = await harness.resolveSlot(ana);

    // The connection falls: the order is persisted and delivered on return.
    harness.device().disconnect();
    await vi.waitFor(
      async () => {
        const res = await harness
          .http()
          .get('/devices/status')
          .set(harness.auth);
        expect(res.body).toMatchObject([
          { deviceId: DEVICE_ID, online: false },
        ]);
      },
      { timeout: 3000, interval: 10 },
    );
    const order = display('Bienvenido');
    const queued = await harness.app
      .get(OutboundSender)
      .sendCommand(DEVICE_ID, order);
    expect(queued).toBe('queued');
    expect(
      await harness.repositories.commands.findById(order.id),
    ).toMatchObject({ status: 'pending' });

    harness.device().reconnect();
    await vi.waitFor(() => expect(harness.device().state).toBe('online'));
    const delivered = await harness.waitForFrame(
      'display.message',
      (message) => message.id === order.id,
    );
    expect(delivered.id).toBe(order.id);
    await vi.waitFor(
      async () => {
        expect(
          await harness.repositories.commands.findById(order.id),
        ).toMatchObject({ status: 'acked' });
      },
      { timeout: 3000, interval: 10 },
    );

    // A repeated frame (same id) is answered with the original ack and runs once.
    await harness.stopDevice();
    raw = await connectRaw();
    const duplicateId = randomUUID();
    raw.send('fingerprint.scan', { slot, confidence: 90 }, duplicateId);
    raw.send('fingerprint.scan', { slot, confidence: 90 }, duplicateId);

    const first = await raw.waitFor(
      'ack',
      (message) => message.ref === duplicateId,
    );
    await vi.waitFor(
      () =>
        expect(
          raw?.framesOf('ack').filter((ack) => ack.ref === duplicateId),
        ).toHaveLength(2),
      { timeout: 3000, interval: 10 },
    );
    const acks = raw.framesOf('ack').filter((ack) => ack.ref === duplicateId);
    expect(acks[1]).toEqual(first);
    // An entry opened by the first frame; the duplicate did not add another.
    expect(await harness.sessions()).toMatchObject([
      { status: 'abierta', student: { id: ana } },
    ]);
    expect(raw.framesOf('scan.result')).toHaveLength(1);
  });

  it('A11 — a short beep at the end of an empty schedule turns itself off', async () => {
    await harness.startDevice();
    await harness.createSchedule({
      name: 'Vacío',
      start: '10:00',
      end: '11:00',
    });
    harness.setNow('11:00');

    const beep = await harness.waitForFrame(
      'alarm.set',
      (message) => message.payload.reason === 'END_BEEP',
    );
    expect(beep.payload).toEqual({
      on: true,
      durationSec: 5,
      reason: 'END_BEEP',
    });
    expect(harness.device().alarm.current).toMatchObject({
      on: true,
      durationSec: 5,
      reason: 'END_BEEP',
    });

    // The device turns the siren off by itself when the 5 s elapse.
    await vi.waitFor(
      () => expect(harness.device().alarm.current?.on).toBe(false),
      { timeout: 7000, interval: 50 },
    );
    expect(await harness.sessions()).toHaveLength(0);
  });

  it('A12 — resolves two back-to-back schedules to the right occurrence', async () => {
    await harness.startDevice();
    const ana = await harness.createEnrolledStudent('111', 'Ana');
    const luis = await harness.createEnrolledStudent('222', 'Luis');
    const first = await harness.createSchedule({
      name: 'A',
      start: '10:00',
      end: '11:00',
    });
    const second = await harness.createSchedule({
      name: 'B',
      start: '11:00',
      end: '12:00',
    });
    await harness.assign(first, ana);
    await harness.assign(second, luis);
    // The sync 15 minutes before the second one loads both templates.
    harness.setNow('10:46');

    expect(await harness.sync()).toMatchObject({ status: 'ok', templates: 2 });
    harness.setNow('10:52');
    const anaSlot = await harness.resolveSlot(ana);
    const luisSlot = await harness.resolveSlot(luis);

    harness.device().scan(anaSlot);
    harness.device().scan(luisSlot);
    await vi.waitFor(
      async () => expect(await harness.openSessions()).toHaveLength(2),
      { timeout: 3000, interval: 10 },
    );

    const open = await harness.openSessions();
    const byStudent = new Map(
      open.map((session) => [
        (session.student as { id: string }).id,
        (session.instance as { scheduleId: string }).scheduleId,
      ]),
    );
    expect(byStudent.get(ana)).toBe(first);
    expect(byStudent.get(luis)).toBe(second);
  });
});
