import { randomBytes, randomUUID } from 'node:crypto';

const TOKEN = 'device-token-123456';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: TOKEN,
  ADMIN_API_KEY: 'admin-key-1234567890',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

const { startScenarioApp, DEVICE_ID, bogotaAt } =
  await import('../support/scenario-app.js');
const { RawDevice } = await import('../support/raw-device.js');
const { OutboundSender } =
  await import('../../src/devices/outbound-sender.service.js');
const { AlarmService } = await import('../../src/alarm/alarm.service.js');
const { AlarmScheduler } = await import('../../src/alarm/alarm-scheduler.js');
const { InstancesService } =
  await import('../../src/schedules/instances.service.js');
const { SyncService } = await import('../../src/sync/sync.service.js');
const { InMemoryLeaderLock, LEADER_LOCK } =
  await import('../../src/common/concurrency/leader-lock.js');
const { ALARM_CONFIG } = await import('../../src/alarm/alarm.config.js');
const { CLOCK } = await import('../../src/common/time/clock.js');

type Harness = Awaited<ReturnType<typeof startScenarioApp>>;
type Raw = Awaited<ReturnType<typeof RawDevice.connect>>;

const PER_SCHEDULE = 30;
/** Students that exit through the raw client, each one sent twice (same id). */
const RESENT = 7;
/** Students that never leave: they trigger the alarm and the timeout. */
const ABANDONED = 3;
const SCAN_STEP_MS = 20_000;
const MAX_SLOTS = 162;

const at = (time: string): Date => bogotaAt(time);

/**
 * One simulated hour (V19). Two consecutive schedules of 30 students share one
 * reader (the gym has a single one), so every scan goes through one
 * connection at a time: the real simulator for most, a protocol client for
 * the repeated frames. The clock is controlled; nothing waits an hour.
 *
 * It asserts correctness, not speed: every message is acked, nothing is lost
 * or duplicated, and the alarm is ordered once per schedule, also with two
 * instances and a change of leader.
 */
describe('Light load: one simulated hour, 30 students per schedule (e2e)', () => {
  let harness: Harness;
  let raw: Raw | undefined;

  beforeAll(async () => {
    harness = await startScenarioApp({ now: at('05:50') });
  });

  afterAll(async () => {
    await raw?.close();
    await harness.close();
  });

  it('keeps every message, one session per student and one alarm per schedule, with two instances', async () => {
    const sender = harness.app.get(OutboundSender);
    // Orders the alarm decides to turn on. The resend to a reader that
    // reconnects while the alarm is already on (`onDeviceConnected`) repeats
    // the same state: it is counted apart and is not a new order.
    const alarmOrders: string[] = [];
    const resyncs: string[] = [];
    let resyncing = false;
    const sendCommand = sender.sendCommand.bind(sender);
    vi.spyOn(sender, 'sendCommand').mockImplementation(
      (deviceId, message, options) => {
        if (message.type === 'alarm.set' && message.payload.on) {
          (resyncing ? resyncs : alarmOrders).push(message.id);
        }
        return sendCommand(deviceId, message, options);
      },
    );
    const alarmService = harness.app.get(AlarmService);
    const onConnected = alarmService.onDeviceConnected.bind(alarmService);
    vi.spyOn(alarmService, 'onDeviceConnected').mockImplementation((id) => {
      resyncing = true;
      try {
        onConnected(id);
      } finally {
        resyncing = false;
      }
    });

    // --- Setup: 60 enrolled students, two back-to-back schedules ----------
    await harness.startDevice();
    const students: string[] = [];
    for (let i = 0; i < PER_SCHEDULE * 2; i++) {
      students.push(
        await harness.createEnrolledStudent(
          String(1000 + i),
          `Student ${i + 1}`,
        ),
      );
    }
    const schedules = [
      await harness.createSchedule({
        name: 'H1',
        start: '06:00',
        end: '07:00',
      }),
      await harness.createSchedule({
        name: 'H2',
        start: '07:00',
        end: '08:00',
      }),
    ];
    for (const [i, id] of students.entries()) {
      await harness.assign(schedules[Math.floor(i / PER_SCHEDULE)], id);
    }

    const syncService = harness.app.get(SyncService);
    const slotOf = new Map<string, number>();
    const loadSlots = async () => {
      slotOf.clear();
      // The server's view: a new connection may be given a new slot plan.
      for (let slot = 1; slot <= MAX_SLOTS; slot++) {
        const student = await syncService.findStudentBySlot(DEVICE_ID, slot);
        if (student) slotOf.set(student.id, slot);
      }
    };

    const sentIds = new Set<string>();
    const resentIds = new Set<string>();
    const rawAckCounts = new Map<string, number>();
    let rawResults = 0;
    let uniqueScans = 0;

    /** Simulator scan: waits for its `scan.result`. */
    const simScan = async (studentId: string, time: Date) => {
      harness.setNow(time);
      const before = harness.framesOf('scan.result').length;
      harness.device().scan(slotOf.get(studentId)!);
      uniqueScans++;
      await vi.waitFor(() =>
        expect(harness.framesOf('scan.result').length).toBe(before + 1),
      );
    };

    /** Protocol client scan; with `twice` the same frame id is sent again. */
    const rawScan = async (studentId: string, time: Date, twice: boolean) => {
      harness.setNow(time);
      const slot = slotOf.get(studentId)!;
      const id = randomUUID();
      raw!.send('fingerprint.scan', { slot, confidence: 90 }, id);
      sentIds.add(id);
      uniqueScans++;
      if (twice) {
        raw!.send('fingerprint.scan', { slot, confidence: 90 }, id);
        resentIds.add(id);
      }
      await vi.waitFor(() =>
        expect(raw!.framesOf('ack').filter((a) => a.ref === id)).toHaveLength(
          twice ? 2 : 1,
        ),
      );
      rawAckCounts.set(id, twice ? 2 : 1);
    };

    const leaving = PER_SCHEDULE - RESENT - ABANDONED;
    /** Everybody enters within the first ten minutes. */
    const enterAll = async (group: string[], start: string) => {
      const t0 = at(start).getTime();
      for (const [i, id] of group.entries()) {
        await simScan(id, new Date(t0 + i * SCAN_STEP_MS));
      }
    };
    /** Most leave at the simulator; RESENT are left for the protocol client. */
    const exitMost = async (group: string[], start: string) => {
      const t0 = at(start).getTime();
      for (const [i, id] of group.slice(0, leaving).entries()) {
        await simScan(id, new Date(t0 + i * SCAN_STEP_MS));
      }
      return group.slice(leaving, leaving + RESENT);
    };

    const switchToRaw = async (
      rawGroup: string[],
      time: string,
    ): Promise<void> => {
      await harness.stopDevice();
      raw = await RawDevice.connect({
        url: harness.wsUrl,
        deviceId: DEVICE_ID,
        token: TOKEN,
      });
      await harness.sync();
      await loadSlots();
      const t = at(time).getTime();
      for (const [i, id] of rawGroup.entries()) {
        await rawScan(id, new Date(t + i * 1000), true);
      }
    };

    const alarmEvents = async () =>
      (await harness.http().get('/history/alarms').set(harness.auth)).body
        .items as Array<{ closedBy: string | null }>;

    // --- Hour 1 (06:00-07:00), instance A leads --------------------------
    harness.setNow('05:59');
    await harness.sync();
    await loadSlots();
    expect(slotOf.size).toBeGreaterThanOrEqual(PER_SCHEDULE);

    const hour1 = students.slice(0, PER_SCHEDULE);
    await enterAll(hour1, '06:00:00');
    const resent1 = await exitMost(hour1, '06:50:00');
    await switchToRaw(resent1, '06:57:30');
    // End of hour 1 with three people inside: one alarm, ordered once.
    harness.setNow('07:00:02');
    await vi.waitFor(async () =>
      expect(await harness.alarmStatus()).toMatchObject({ on: true }),
    );
    expect(alarmOrders).toHaveLength(1);
    expect(await alarmEvents()).toHaveLength(1);

    // --- Hour 2 (07:00-08:00): the second reader session -----------------
    rawResults += raw!.framesOf('scan.result').length;
    await raw?.close();
    raw = undefined;
    await harness.startDevice();
    // The alarm of hour 1 is still on: the new connection gets it again.
    await vi.waitFor(() => expect(resyncs).toHaveLength(1));
    harness.setNow('07:00:30');
    await harness.sync();
    await loadSlots();
    expect(slotOf.size).toBeGreaterThanOrEqual(PER_SCHEDULE);
    const hour2 = students.slice(PER_SCHEDULE);
    await enterAll(hour2, '07:01:00');

    // --- Two instances: B waits, then takes over when A loses the lock ---
    const lockA =
      harness.app.get<InstanceType<typeof InMemoryLeaderLock>>(LEADER_LOCK);
    // Same registry as A's lock, so only one of the two can lead.
    const lockB = new InMemoryLeaderLock(
      (lockA as unknown as { registry: never })['registry'],
    );
    expect(lockB.start()).toBe(false);

    const realAlarm = alarmService;
    const realTick = vi.spyOn(realAlarm, 'tick');
    let ticksByB = 0;
    let recoversByB = 0;
    const alarmForB = {
      tick: (now: Date) => {
        ticksByB++;
        return realAlarm.tick(now);
      },
      recover: (now: Date) => {
        recoversByB++;
        return realAlarm.recover(now);
      },
    } as unknown as InstanceType<typeof AlarmService>;
    const schedulerB = new AlarmScheduler(
      harness.app.get(InstancesService),
      alarmForB,
      harness.app.get(CLOCK),
      harness.app.get(ALARM_CONFIG),
      lockB,
    );

    // While A leads, B does nothing, however often it is asked to tick.
    harness.setNow('07:15');
    for (let i = 0; i < 20; i++) await schedulerB.tick();
    expect(ticksByB + recoversByB).toBe(0);

    // A loses the lock in the middle of hour 2; B recovers, then evaluates.
    lockA.stop();
    expect(lockB.retry()).toBe(true);
    await schedulerB.tick();
    expect(recoversByB).toBe(1);
    const callsBefore = realTick.mock.calls.length;
    harness.setNow('07:30:01');
    await schedulerB.tick();
    // A's own timer keeps running but no longer evaluates: every tick of the
    // service since the change came from B.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(realTick.mock.calls.length - callsBefore).toBe(ticksByB);
    expect(ticksByB).toBe(1);

    // Hour 1's three abandoned sessions close at the timeout, without a new alarm.
    expect(alarmOrders).toHaveLength(1);
    const noRegistrada = async (scheduleId: string) =>
      (
        await harness.sessions({ status: 'no_registrada', limit: '200' })
      ).filter(
        (s) => (s.instance as { scheduleId: string }).scheduleId === scheduleId,
      );
    expect(await noRegistrada(schedules[0])).toHaveLength(ABANDONED);

    // Exits of hour 2: most at the simulator, the rest repeated through the
    // protocol client.
    const resent2 = await exitMost(hour2, '07:50:00');
    await switchToRaw(resent2, '07:57:30');

    // End of hour 2: B (the new leader) orders the alarm once.
    harness.setNow('08:00:02');
    await schedulerB.tick();
    await vi.waitFor(async () =>
      expect(await harness.alarmStatus()).toMatchObject({ on: true }),
    );
    await schedulerB.tick();
    await schedulerB.tick();
    expect(alarmOrders).toHaveLength(2);
    expect(await alarmEvents()).toHaveLength(2);

    harness.setNow('08:30:01');
    await schedulerB.tick();
    expect(await noRegistrada(schedules[1])).toHaveLength(ABANDONED);
    expect(alarmOrders).toHaveLength(2);

    // --- Final accounting -------------------------------------------------
    // Every message the clients sent got its ack (the repeated ones, twice).
    const simSent = harness
      .sentFrames()
      .filter((frame) => frame.type === 'fingerprint.scan')
      .map((frame) => frame.id as string);
    const simAcks = harness.framesOf('ack').map((ack) => ack.ref);
    for (const id of simSent) expect(simAcks, `ack of ${id}`).toContain(id);
    expect(rawAckCounts.size).toBe(RESENT * 2);
    for (const id of sentIds) {
      expect(rawAckCounts.get(id), `ack of ${id}`).toBe(
        resentIds.has(id) ? 2 : 1,
      );
    }

    // No scan lost, none duplicated: one result per unique scan, none for the
    // repeated frames.
    rawResults += raw!.framesOf('scan.result').length;
    expect(simSent.length + sentIds.size).toBe(uniqueScans);
    expect(harness.framesOf('scan.result')).toHaveLength(simSent.length);
    expect(rawResults).toBe(sentIds.size);

    // Exactly one session per student and schedule.
    const sessions = await harness.sessions({ limit: '200' });
    expect(sessions).toHaveLength(PER_SCHEDULE * 2);
    const keys = sessions.map(
      (s) =>
        `${(s.student as { id: string }).id}/${(s.instance as { scheduleId: string }).scheduleId}`,
    );
    expect(new Set(keys).size).toBe(PER_SCHEDULE * 2);
    expect(sessions.filter((s) => s.status === 'cerrada')).toHaveLength(
      (PER_SCHEDULE - ABANDONED) * 2,
    );
    expect(sessions.filter((s) => s.status === 'no_registrada')).toHaveLength(
      ABANDONED * 2,
    );
    expect(await harness.openSessions()).toHaveLength(0);
  });
});
