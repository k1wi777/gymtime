import { randomUUID } from 'node:crypto';
import { DEVICE, bogota, buildOfflineFixture, unix } from './testing.js';

async function setup(documents = ['1']) {
  const f = buildOfflineFixture();
  const { schedule, students } = await f.world(documents);
  const roster = Object.fromEntries(students.map((s, i) => [i + 1, s.id]));
  const snapshotId = await f.snapshotOf(schedule.schedule.id, roster);
  return { f, schedule, students, snapshotId };
}

describe('OfflineEventsService (R5-R12)', () => {
  it('rebuilds entry and exit with the original instants, not the server clock (R8)', async () => {
    const { f, students, snapshotId } = await setup();

    const summary = await f.offline.handleBatch(
      DEVICE,
      f.batch([
        f.event(snapshotId, 'exit', 1, '10:50'),
        f.event(snapshotId, 'entry', 1, '10:03'),
      ]),
    );

    expect(summary).toMatchObject({ applied: 2, review: 0, invalid: 0 });
    const [session] = await f.attendanceRepo.list();
    expect(session).toMatchObject({
      studentId: students[0]!.id,
      status: 'cerrada',
      entrySource: 'offline',
      exitSource: 'offline',
      enteredAt: bogota('10:03'),
      exitedAt: bogota('10:50'),
    });
    expect(f.clock.now()).toEqual(bogota('11:30'));
  });

  it('applies the events of a student in ts order, then seq', async () => {
    const { f, snapshotId } = await setup();
    const early = f.event(snapshotId, 'entry', 1, '10:03');
    const late = f.event(snapshotId, 'exit', 1, '10:03', {
      seq: early.seq + 5,
    });
    await f.offline.handleBatch(DEVICE, f.batch([late, early]));
    const [session] = await f.attendanceRepo.list();
    expect(session?.status).toBe('cerrada');
  });

  it('does not duplicate sessions when the same batch comes again (R6)', async () => {
    const { f, snapshotId } = await setup();
    const events = [
      f.event(snapshotId, 'entry', 1, '10:03'),
      f.event(snapshotId, 'exit', 1, '10:50'),
    ];
    const first = await f.offline.handleBatch(DEVICE, f.batch(events));
    const again = await f.offline.handleBatch(
      DEVICE,
      f.batch(events, { messageId: randomUUID() }),
    );

    expect(first.applied).toBe(2);
    expect(again).toMatchObject({ applied: 0, review: 0, duplicates: 2 });
    expect(await f.attendanceRepo.list()).toHaveLength(1);
  });

  it('processes only the new events of a partially repeated batch', async () => {
    const { f, snapshotId } = await setup(['1', '2']);
    const a = f.event(snapshotId, 'entry', 1, '10:03');
    const b = f.event(snapshotId, 'entry', 2, '10:04');
    await f.offline.handleBatch(DEVICE, f.batch([a]));
    const summary = await f.offline.handleBatch(DEVICE, f.batch([a, b]));
    expect(summary).toMatchObject({ applied: 1, duplicates: 1 });
    expect(await f.attendanceRepo.list()).toHaveLength(2);
  });

  it('counts an id repeated inside one batch once', async () => {
    const { f, snapshotId } = await setup();
    const a = f.event(snapshotId, 'entry', 1, '10:03');
    const summary = await f.offline.handleBatch(DEVICE, f.batch([a, a]));
    expect(summary).toMatchObject({ applied: 1, duplicates: 1 });
  });

  it('an invalid event does not fail the batch and is audited without its content (R5, R19)', async () => {
    const { f, snapshotId } = await setup();
    const bad = { ...f.event(snapshotId, 'entry', 1, '10:03'), extra: 'x' };
    const good = f.event(snapshotId, 'entry', 1, '10:04');
    const summary = await f.offline.handleBatch(
      DEVICE,
      f.batch([bad, { nonsense: true }, good]),
    );

    expect(summary).toMatchObject({ applied: 1, invalid: 2, received: 3 });
    const audit = f.eventLog.entries.find((e) => e.type === 'offline.batch');
    expect(audit?.detail).toMatchObject({
      invalid: 2,
      invalidEvents: [
        { index: 0, fields: expect.any(Array) },
        { index: 1, fields: expect.any(Array) },
      ],
    });
    expect(JSON.stringify(audit)).not.toMatch(/Student 1|extra/);
  });

  it('links the session of an event cut by a crash instead of duplicating it', async () => {
    const { f, students, snapshotId } = await setup();
    const entry = f.event(snapshotId, 'entry', 1, '10:03');
    // The session was saved, the outcome was not: the event stays `pendiente`.
    await f.events.insertIfAbsent([
      {
        deviceId: DEVICE,
        id: entry.id,
        seq: entry.seq,
        ts: new Date(entry.ts * 1000),
        type: 'entry',
        slot: 1,
        snapshotId,
        batchId: randomUUID(),
        receivedAt: bogota('11:00'),
      },
    ]);
    const facts = await f.attendance.offlineFacts(
      students[0]!,
      'entry',
      bogota('10:03'),
    );
    if (facts.decision?.kind !== 'entry') throw new Error('expected entry');
    await f.attendance.applyOfflineEntry(
      students[0]!,
      facts.decision.occurrence,
      bogota('10:03'),
    );

    const summary = await f.offline.handleBatch(DEVICE, f.batch([entry]));

    expect(summary).toMatchObject({ applied: 1, review: 0 });
    expect(await f.attendanceRepo.list()).toHaveLength(1);
    expect((await f.events.findById(DEVICE, entry.id))?.outcome).toBe(
      'applied',
    );
  });

  describe('the snapshot decides who a slot is (R9)', () => {
    it('keeps attributing an old event to the person of its snapshot', async () => {
      const { f, students, snapshotId } = await setup(['1', '2']);
      // A later sync gave slot 1 to someone else; the old event still means Ana.
      await f.snapshotOf(null, { 1: students[1]!.id });
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'entry', 1, '10:03')]),
      );
      const [session] = await f.attendanceRepo.list();
      expect(session?.studentId).toBe(students[0]!.id);
    });

    it('sends an unknown snapshot to review', async () => {
      const { f } = await setup();
      const summary = await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(randomUUID(), 'entry', 1, '10:03')]),
      );
      expect(summary.review).toBe(1);
      const { items } = await f.events.list({ outcomes: ['por_revisar'] });
      expect(items[0]?.reviewReason).toBe('UNKNOWN_SNAPSHOT');
      expect(await f.attendanceRepo.list()).toHaveLength(0);
    });

    it('sends a slot missing from the roster to review', async () => {
      const { f, snapshotId } = await setup();
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'entry', 99, '10:03')]),
      );
      const { items } = await f.events.list({ outcomes: ['por_revisar'] });
      expect(items[0]?.reviewReason).toBe('UNKNOWN_SLOT');
    });

    it('does not use a snapshot of another device', async () => {
      const { f, snapshotId } = await setup();
      const summary = await f.offline.handleBatch(
        'other-device',
        f.batch([f.event(snapshotId, 'entry', 1, '10:03')]),
      );
      expect(summary.review).toBe(1);
    });
  });

  describe('conflicts go to review without being lost (R10, R11)', () => {
    async function reasonsOf(f: Awaited<ReturnType<typeof setup>>['f']) {
      const { items } = await f.events.list({ outcomes: ['por_revisar'] });
      return items.map((e) => e.reviewReason);
    }

    it('exit without entry', async () => {
      const { f, snapshotId } = await setup();
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'exit', 1, '10:50')]),
      );
      expect(await reasonsOf(f)).toEqual(['EXIT_WITHOUT_ENTRY']);
    });

    it('a second entry', async () => {
      const { f, snapshotId } = await setup();
      await f.offline.handleBatch(
        DEVICE,
        f.batch([
          f.event(snapshotId, 'entry', 1, '10:03'),
          f.event(snapshotId, 'entry', 1, '10:04'),
        ]),
      );
      expect(await reasonsOf(f)).toEqual(['DUPLICATE_ENTRY']);
    });

    it('entry outside the window and of a student not in the schedule', async () => {
      const { f, snapshotId } = await setup(['1']);
      const stranger = await f.newStudent('9');
      const other = await f.snapshotOf(null, { 7: stranger.id });
      await f.offline.handleBatch(
        DEVICE,
        f.batch([
          f.event(snapshotId, 'entry', 1, '10:58'),
          f.event(other, 'entry', 7, '10:05'),
        ]),
      );
      expect((await reasonsOf(f)).sort()).toEqual([
        'NOT_IN_SCHEDULE',
        'OUTSIDE_WINDOW',
      ]);
    });

    it('entry after the student already exited', async () => {
      const { f, snapshotId } = await setup();
      await f.offline.handleBatch(
        DEVICE,
        f.batch([
          f.event(snapshotId, 'entry', 1, '10:03'),
          f.event(snapshotId, 'exit', 1, '10:20'),
          f.event(snapshotId, 'entry', 1, '10:30'),
        ]),
      );
      expect(await reasonsOf(f)).toEqual(['ALREADY_EXITED']);
    });

    it('an event too far ahead of or behind the server clock', async () => {
      const { f, snapshotId } = await setup();
      const future = f.event(snapshotId, 'entry', 1, '10:03', {
        ts: unix('11:30') + 600,
      });
      const old = f.event(snapshotId, 'entry', 1, '10:03', {
        ts: unix('11:30') - 73 * 3600,
      });
      const lost = f.event(snapshotId, 'entry', 1, '10:03', { ts: 1000 });
      await f.offline.handleBatch(DEVICE, f.batch([future, old, lost]));
      expect((await reasonsOf(f)).sort()).toEqual([
        'TS_FUTURE',
        'TS_TOO_OLD',
        'TS_TOO_OLD',
      ]);
      expect(await f.attendanceRepo.list()).toHaveLength(0);
    });

    it('an event older than one already applied, even from another batch', async () => {
      const { f, snapshotId } = await setup();
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'entry', 1, '10:30')], { last: false }),
      );
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'exit', 1, '10:10')]),
      );
      expect(await reasonsOf(f)).toEqual(['OUT_OF_ORDER']);
    });

    it('an inactive student', async () => {
      const { f, students, snapshotId } = await setup();
      await f.students.deactivate(students[0]!.id);
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'entry', 1, '10:03')]),
      );
      expect(await reasonsOf(f)).toEqual(['STUDENT_INACTIVE']);
    });

    it('counts unknown fingerprints as informative only', async () => {
      const { f, snapshotId } = await setup();
      const summary = await f.offline.handleBatch(
        DEVICE,
        f.batch([
          {
            id: randomUUID(),
            seq: 1,
            ts: unix('10:05'),
            snapshotId,
            type: 'unknown',
          },
        ]),
      );
      expect(summary).toMatchObject({ informative: 1, applied: 0, review: 0 });
    });
  });

  describe('alarm after the end (R13)', () => {
    it('lights the usual continuous alarm for sessions left open inside the timeout', async () => {
      const { f, snapshotId } = await setup();
      await f.markOnline();
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'entry', 1, '10:03')]),
      );
      // 11:30 is 30 min after the end: exactly the default timeout.
      expect((await f.events.list({ outcomes: ['applied'] })).total).toBe(1);
      expect(
        await f.attendance.countOpenByInstance(
          (await f.attendanceRepo.list())[0]!.instanceId,
        ),
      ).toBe(1);
      expect(f.alarms().some((a) => a.on && a.reason === 'PENDING_EXIT')).toBe(
        true,
      );
    });

    it('closes them as no_registrada with timeout beyond it', async () => {
      const { f, snapshotId } = await setup();
      f.setNow(bogota('12:00'));
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'entry', 1, '10:03')]),
      );
      const [session] = await f.attendanceRepo.list();
      expect(session).toMatchObject({
        status: 'no_registrada',
        manualReason: 'timeout',
      });
      expect(f.alarms()).toEqual([]);
    });

    it('sends an exit over a session the server closed to review, untouched', async () => {
      const { f, snapshotId } = await setup();
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'entry', 1, '10:03')], { last: false }),
      );
      f.setNow(bogota('12:00'));
      await f.alarmService.tick(bogota('12:00'));
      const [closed] = await f.attendanceRepo.list();
      expect(closed?.status).toBe('no_registrada');

      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'exit', 1, '11:50')]),
      );

      const { items } = await f.events.list({ outcomes: ['por_revisar'] });
      expect(items[0]?.reviewReason).toBe('SESSION_ALREADY_CLOSED');
      expect((await f.attendanceRepo.list())[0]).toMatchObject({
        status: 'no_registrada',
        exitedAt: null,
      });
    });

    it('stops the alarm when the offline exits empty the occurrence', async () => {
      const { f, snapshotId } = await setup();
      await f.markOnline();
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'entry', 1, '10:03')], { last: false }),
      );
      expect(f.alarms().some((a) => a.on)).toBe(true);
      await f.offline.handleBatch(
        DEVICE,
        f.batch([f.event(snapshotId, 'exit', 1, '11:20')]),
      );
      expect(f.alarms().at(-1)).toMatchObject({ on: false, reason: 'CLEARED' });
    });
  });

  describe('local alarms (R14)', () => {
    it('are stored once as local history and never ring the siren', async () => {
      const { f, schedule, snapshotId } = await setup();
      await f.markOnline();
      const alarm = {
        id: randomUUID(),
        seq: 1,
        ts: unix('11:00'),
        snapshotId,
        type: 'alarm',
        endTs: unix('11:02'),
        endedBy: 'button',
      };
      const first = await f.offline.handleBatch(DEVICE, f.batch([alarm]));
      const second = await f.offline.handleBatch(DEVICE, f.batch([alarm]));

      expect(first.alarms).toBe(1);
      expect(second.duplicates).toBe(1);
      const instance = (await f.instancesOf())[0]!;
      const rows = await f.events.list({ outcomes: ['applied'] });
      expect(rows.total).toBe(1);
      expect(rows.items[0]?.instanceId).toBe(instance.id);
      expect(schedule.schedule.id).toBe(instance.scheduleId);
      const stored = await f.alarmEvents.findByInstanceIds([instance.id]);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        origin: 'local',
        closedBy: 'button',
        startedAt: bogota('11:00'),
        endedAt: bogota('11:02'),
        deviceId: DEVICE,
      });
      expect(await f.alarmEvents.findOpen()).toEqual([]);
      expect(f.alarms()).toEqual([]);
      expect((await f.alarmService.status()).on).toBe(false);
    });

    it('records one that was still sounding as ended by timeout', async () => {
      const { f, snapshotId } = await setup();
      await f.offline.handleBatch(
        DEVICE,
        f.batch([
          {
            id: randomUUID(),
            seq: 1,
            ts: unix('11:00'),
            snapshotId,
            type: 'alarm',
            endTs: null,
            endedBy: 'timeout',
          },
        ]),
      );
      const instance = (await f.instancesOf())[0]!;
      const [stored] = await f.alarmEvents.findByInstanceIds([instance.id]);
      expect(stored).toMatchObject({
        closedBy: 'timeout',
        endedAt: bogota('11:30'),
      });
    });
  });
});
