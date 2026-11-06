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

const { startScenarioApp, DEVICE_ID } =
  await import('./support/scenario-app.js');

type Harness = Awaited<ReturnType<typeof startScenarioApp>>;

/** H6: display.message, screen texts, validity intervals and the audit trail. */
describe('Display and data preparation (e2e)', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startScenarioApp();
  });

  afterEach(async () => {
    await harness.close();
  });

  const post = (body: Record<string, unknown>) =>
    harness.http().post('/devices/messages').set(harness.auth).send(body);

  const waitOffline = () =>
    vi.waitFor(
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

  describe('POST /devices/messages (R1, R2, R3, R4)', () => {
    it('shows the normalized message in the simulator and confirms it', async () => {
      await harness.startDevice();

      const res = await post({ line1: 'Atención', line2: 'mañana' }).expect(
        200,
      );

      expect(res.body).toMatchObject({ deviceId: DEVICE_ID, status: 'acked' });
      const frame = await harness.waitForFrame(
        'display.message',
        (message) => message.id === res.body.commandId,
      );
      expect(frame.payload).toEqual({
        line1: 'Atencion',
        line2: 'manana',
        durationSec: 3,
      });
      await vi.waitFor(() =>
        expect(harness.output()).toContain(
          '::: display.message: "Atencion" / "manana" (3s)',
        ),
      );
      expect(
        await harness.repositories.commands.findById(res.body.commandId),
      ).toMatchObject({ status: 'acked', type: 'display.message' });
    });

    it('queues messages while the device is down and delivers them in order on reconnect', async () => {
      const device = await harness.startDevice();
      device.disconnect();
      await waitOffline();

      const first = await post({ line1: 'Uno', durationSec: 5 }).expect(200);
      const second = await post({ line1: 'Dos' }).expect(200);
      expect(first.body.status).toBe('queued');
      expect(second.body.status).toBe('queued');
      expect(
        await harness.repositories.commands.findById(first.body.commandId),
      ).toMatchObject({ status: 'pending' });

      device.reconnect();
      await vi.waitFor(() => expect(device.state).toBe('online'));
      await harness.waitForFrame(
        'display.message',
        (message) => message.id === second.body.commandId,
      );
      const ids = harness.framesOf('display.message').map((m) => m.id);
      expect(ids).toEqual([first.body.commandId, second.body.commandId]);
      await vi.waitFor(async () =>
        expect(
          await harness.repositories.commands.findById(second.body.commandId),
        ).toMatchObject({ status: 'acked' }),
      );
    });

    it('rejects a text that does not fit without creating any order', async () => {
      await harness.startDevice();
      const res = await post({ line1: 'x'.repeat(17) }).expect(400);
      expect(res.body.message).toContain('la línea 1 tiene 17 caracteres');
      await post({ line1: 'ok', durationSec: 99 }).expect(400);
      expect(harness.framesOf('display.message')).toHaveLength(0);
    });

    it('audits the message as a system action (R19)', async () => {
      await harness.startDevice();
      await post({ line1: 'Hola' }).expect(200);
      expect(harness.repositories.eventLog.entries).toContainEqual(
        expect.objectContaining({
          type: 'display.message_sent',
          actor: { type: 'system', id: null },
        }),
      );
    });
  });

  describe('scan.result texts (R10)', () => {
    it('shows the display name and the Anexo B result lines', async () => {
      await harness.startDevice();
      const ana = await harness.createEnrolledStudent(
        '111',
        'Ana María Gómez Pérez',
      );
      const scheduleId = await harness.createSchedule({
        name: 'A',
        start: '10:00',
        end: '11:00',
      });
      await harness.assign(scheduleId, ana);
      harness.setNow('10:30');
      await harness.sync();
      const slot = await harness.resolveSlot(ana);

      harness.device().scan(slot);
      const entry = await harness.waitForFrame(
        'scan.result',
        (message) => message.payload.result === 'entry',
      );

      expect(entry.payload.studentName).toBe('Ana María Gómez Pérez');
      expect(entry.payload.display).toMatchObject({
        line1: 'Ana M.',
        line2: 'Entrada OK',
      });
    });
  });

  describe('alarm message (R12, R13)', () => {
    async function alarmed() {
      await harness.startDevice();
      const ana = await harness.createEnrolledStudent('111', 'Ana');
      const scheduleId = await harness.createSchedule({
        name: 'A',
        start: '10:00',
        end: '11:00',
      });
      await harness.assign(scheduleId, ana);
      harness.setNow('10:30');
      await harness.sync();
      const slot = await harness.resolveSlot(ana);
      harness.device().scan(slot);
      await harness.waitForFrame(
        'scan.result',
        (message) => message.payload.result === 'entry',
      );
      harness.setNow('11:00');
      return { slot };
    }

    it('shows "Tiempo cumplido" with the alarm and clears it when the last one leaves', async () => {
      const { slot } = await alarmed();

      const shown = await harness.waitForFrame(
        'display.message',
        (message) => message.payload.line1 === 'Tiempo cumplido',
      );
      expect(shown.payload).toEqual({
        line1: 'Tiempo cumplido',
        line2: 'Registre salida',
        durationSec: 30 * 60,
      });

      harness.setNow('11:01');
      harness.device().scan(slot);
      const cleared = await harness.waitForFrame(
        'display.message',
        (message) => message.payload.line1 === '',
      );
      expect(cleared.payload).toEqual({ line1: '', line2: '', durationSec: 1 });
      await vi.waitFor(() =>
        expect(harness.output()).toContain(
          '::: display.message: (screen cleared) (1s)',
        ),
      );
    });

    it('resends the message to a device that reconnects while the alarm is on and drops it once cleared', async () => {
      await alarmed();
      await harness.waitForFrame(
        'display.message',
        (message) => message.payload.line1 === 'Tiempo cumplido',
      );
      const device = harness.device();
      device.disconnect();
      await waitOffline();

      device.reconnect();
      await vi.waitFor(() => expect(device.state).toBe('online'));
      await vi.waitFor(() =>
        expect(
          harness
            .framesOf('display.message')
            .filter((m) => m.payload.line1 === 'Tiempo cumplido').length,
        ).toBeGreaterThanOrEqual(2),
      );

      // Silenced while the device is down: the old message is not replayed.
      device.disconnect();
      await waitOffline();
      await harness.http().post('/alarm/off').set(harness.auth).expect(200);
      const shownBefore = harness
        .framesOf('display.message')
        .filter((m) => m.payload.line1 === 'Tiempo cumplido').length;
      device.reconnect();
      await vi.waitFor(() => expect(device.state).toBe('online'));
      await harness.waitForFrame(
        'display.message',
        (message) => message.payload.line1 === '',
      );
      expect(
        harness
          .framesOf('display.message')
          .filter((m) => m.payload.line1 === 'Tiempo cumplido'),
      ).toHaveLength(shownBefore);
    });

    it('audits the button as the device and the CLI as the system (R19)', async () => {
      await alarmed();
      await harness.waitForFrame(
        'display.message',
        (message) => message.payload.line1 === 'Tiempo cumplido',
      );
      harness.device().pressButton();
      await harness.waitForFrame(
        'alarm.set',
        (message) => message.payload.reason === 'CLEARED',
      );
      expect(harness.repositories.eventLog.entries).toContainEqual(
        expect.objectContaining({
          type: 'alarm.button_off',
          actor: { type: 'device', id: DEVICE_ID },
        }),
      );
    });
  });

  describe('validity intervals (R15-R18)', () => {
    it('applies a removal and a reassignment to the very next scan, keeping the history', async () => {
      await harness.startDevice();
      const ana = await harness.createEnrolledStudent('111', 'Ana');
      const scheduleId = await harness.createSchedule({
        name: 'A',
        start: '10:00',
        end: '11:00',
      });
      await harness.assign(scheduleId, ana);
      harness.setNow('10:30');
      await harness.sync();
      const slot = await harness.resolveSlot(ana);

      await harness.unassign(scheduleId, ana);
      await harness.unassign(scheduleId, ana); // idempotent, still 204
      harness.device().scan(slot);
      const denied = await harness.waitForFrame('scan.result');
      expect(denied.payload).toMatchObject({
        result: 'denied',
        reason: 'NOT_IN_SCHEDULE',
      });
      expect(await harness.sessions()).toHaveLength(0);

      harness.advance(1000);
      await harness.assign(scheduleId, ana);
      harness.device().scan(slot);
      await harness.waitForFrame(
        'scan.result',
        (message) => message.payload.result === 'entry',
      );
      expect(await harness.sessions()).toHaveLength(1);

      const history =
        await harness.repositories.schedules.listAssignments(scheduleId);
      expect(history).toHaveLength(2);
      expect(history[0]?.validTo).not.toBeNull();
      expect(history[1]?.validTo).toBeNull();
      const types = harness.repositories.eventLog.entries.map((e) => e.type);
      expect(types).toContain('schedule.student_unassigned');
      expect(
        types.filter((t) => t === 'schedule.student_assigned'),
      ).toHaveLength(2);
    });
  });

  describe('student data', () => {
    it('stores contact data, never logs it nor sends it to the reader', async () => {
      await harness.startDevice();
      const res = await harness
        .http()
        .post('/students')
        .set(harness.auth)
        .send({
          document: '222',
          name: 'Eva Ruiz',
          program: 'Ingenieria',
          email: 'eva@unicordoba.edu.co',
          phone: '+57 300 111 2233',
          consented: true,
        })
        .expect(201);
      expect(res.body).toMatchObject({
        program: 'Ingenieria',
        email: 'eva@unicordoba.edu.co',
        phone: '+57 300 111 2233',
        displayName: 'Eva Ruiz',
      });
      const audit = JSON.stringify(harness.repositories.eventLog.entries);
      expect(audit).not.toContain('eva@unicordoba');
      expect(audit).not.toContain('300 111 2233');
      // Deactivation keeps working with contact data.
      await harness
        .http()
        .delete(`/students/${res.body.id}`)
        .set(harness.auth)
        .expect(200);
      expect(
        (await harness.http().get('/students').set(harness.auth)).body[0],
      ).toMatchObject({ active: false, email: 'eva@unicordoba.edu.co' });
      expect(JSON.stringify(harness.sentFrames())).not.toContain('eva@');
    });
  });
});
