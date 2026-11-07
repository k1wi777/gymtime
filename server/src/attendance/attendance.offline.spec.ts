import { buildAttendanceFixture } from './testing.js';

const bogota = (hhmm: string, date = '2026-11-02') =>
  new Date(`${date}T${hhmm}:00-05:00`);

async function world(start = '10:00', end = '11:00') {
  const f = buildAttendanceFixture();
  const schedule = await f.weekly('A', start, end);
  const ana = await f.newStudent('1');
  await f.schedules.assignStudent(schedule.schedule.id, ana.id);
  return { f, ana };
}

describe('AttendanceService offline operations (R8)', () => {
  it('records an entry with the reader instant, not the server clock', async () => {
    const { f, ana } = await world();
    f.setNow(bogota('18:00'));
    const facts = await f.service.offlineFacts(ana, 'entry', bogota('10:03'));
    expect(facts.decision?.kind).toBe('entry');
    if (facts.decision?.kind !== 'entry') return;

    const created = await f.service.applyOfflineEntry(
      ana,
      facts.decision.occurrence,
      bogota('10:03'),
    );

    expect(created).toMatchObject({
      enteredAt: bogota('10:03'),
      entrySource: 'offline',
      status: 'abierta',
    });
  });

  it('decides an entry with the rules of its own instant', async () => {
    const { f, ana } = await world();
    f.setNow(bogota('18:00'));
    const early = await f.service.offlineFacts(ana, 'entry', bogota('09:00'));
    const late = await f.service.offlineFacts(ana, 'entry', bogota('10:56'));
    expect(early.decision).toEqual({
      kind: 'denied',
      reason: 'NO_ACTIVE_SCHEDULE',
    });
    expect(late.decision).toEqual({
      kind: 'denied',
      reason: 'OUTSIDE_ENTRY_WINDOW',
    });
  });

  it('closes a session with the reader exit and tells the alarm when empty', async () => {
    const { f, ana } = await world();
    f.setNow(bogota('18:00'));
    const facts = await f.service.offlineFacts(ana, 'entry', bogota('10:03'));
    if (facts.decision?.kind !== 'entry') throw new Error('expected entry');
    const session = await f.service.applyOfflineEntry(
      ana,
      facts.decision.occurrence,
      bogota('10:03'),
    );

    const exit = await f.service.offlineFacts(ana, 'exit', bogota('10:58'));
    expect(exit.openSession?.id).toBe(session.id);
    const closed = await f.service.applyOfflineExit(
      ana,
      session.id,
      bogota('10:58'),
    );

    expect(closed).toMatchObject({
      status: 'cerrada',
      exitedAt: bogota('10:58'),
      exitSource: 'offline',
    });
    expect(f.onInstanceEmptied).toHaveBeenCalledWith(session.instanceId);
    expect(
      await f.service.applyOfflineExit(ana, session.id, bogota('10:59')),
    ).toBeNull();
  });

  it('reports a session the server closed as no_registrada (R13)', async () => {
    const { f, ana } = await world();
    f.setNow(bogota('10:05'));
    f.slot(ana);
    await f.service.recordScan('dev', 1, 0);
    const [session] = await f.repository.list();
    await f.service.markUnregisteredByInstance(session.instanceId, 'timeout');

    const exit = await f.service.offlineFacts(ana, 'exit', bogota('11:20'));
    expect(exit).toMatchObject({
      openSession: null,
      serverClosedSession: true,
    });

    const closed = await f.service.reopenUnregisteredWithExit(
      ana,
      bogota('11:20'),
    );
    expect(closed).toMatchObject({
      status: 'cerrada',
      exitSource: 'offline',
      exitedAt: bogota('11:20'),
    });
  });

  it('finds the effect of an event applied before a crash', async () => {
    const { f, ana } = await world();
    f.setNow(bogota('18:00'));
    const facts = await f.service.offlineFacts(ana, 'entry', bogota('10:03'));
    if (facts.decision?.kind !== 'entry') throw new Error('expected entry');
    const session = await f.service.applyOfflineEntry(
      ana,
      facts.decision.occurrence,
      bogota('10:03'),
    );
    expect(
      (await f.service.findOfflineEffect(ana.id, 'entry', bogota('10:03')))?.id,
    ).toBe(session.id);
    expect(
      await f.service.findOfflineEffect(ana.id, 'exit', bogota('10:03')),
    ).toBeNull();
  });

  it('lists who already left an occurrence', async () => {
    const { f, ana } = await world();
    f.setNow(bogota('10:05'));
    f.slot(ana);
    await f.service.recordScan('dev', 1, 0);
    f.setNow(bogota('10:50'));
    await f.service.recordScan('dev', 1, 0);
    const [session] = await f.repository.list();
    expect(
      await f.service.listClosedStudentIdsByInstance(session.instanceId),
    ).toEqual([ana.id]);
  });
});
