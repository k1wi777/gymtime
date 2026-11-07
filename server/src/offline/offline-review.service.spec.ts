import { runAsActor } from '../common/audit/actor.js';
import { DEVICE, bogota, buildOfflineFixture, unix } from './testing.js';

type Fixture = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const f = buildOfflineFixture();
  const { schedule, students } = await f.world(['1', '2']);
  const snapshotId = await f.snapshotOf(schedule.schedule.id, {
    1: students[0]!.id,
    2: students[1]!.id,
  });
  const ana = students[0]!;
  const pending = async (reason: string) => {
    const { items } = await f.events.list({ outcomes: ['por_revisar'] });
    const found = items.find((e) => e.reviewReason === reason);
    if (!found) throw new Error(`no pending event with ${reason}`);
    return found;
  };
  return { f, ana, snapshotId, pending, schedule };
}

const asUser = <T>(action: () => Promise<T>) =>
  runAsActor({ type: 'user', id: null }, action);

async function lateEntry(f: Fixture['f'], snapshotId: string) {
  // 10:58 is past the entry window (closes 10:55): OUTSIDE_WINDOW.
  await f.offline.handleBatch(
    DEVICE,
    f.batch([f.event(snapshotId, 'entry', 1, '10:58')]),
  );
}

describe('OfflineReviewService (R15, R19)', () => {
  it('lists pending events with the student, the schedule and the valid actions', async () => {
    const { f, ana, snapshotId } = await setup();
    await lateEntry(f, snapshotId);
    await f.offline.handleBatch(
      DEVICE,
      f.batch([f.event(snapshotId, 'exit', 2, '10:40')]),
    );

    const { items, total } = await f.review.list({ outcomes: ['por_revisar'] });

    expect(total).toBe(2);
    expect(await f.review.count()).toBe(2);
    expect(
      items.find((i) => i.record.reviewReason === 'OUTSIDE_WINDOW'),
    ).toMatchObject({
      student: { id: ana.id },
      actions: ['aprobar', 'corregir', 'descartar'],
    });
    expect(
      items.find((i) => i.record.reviewReason === 'EXIT_WITHOUT_ENTRY')
        ?.actions,
    ).toEqual(['corregir', 'descartar']);
  });

  it('approves an entry as it is, keeping its hour and auditing user, action and reason', async () => {
    const { f, ana, snapshotId, pending } = await setup();
    await lateEntry(f, snapshotId);
    const event = await pending('OUTSIDE_WINDOW');

    const item = await asUser(() =>
      f.review.resolve(event.id, {
        action: 'aprobar',
        reason: 'Llegó con el instructor',
      }),
    );

    expect(item.record).toMatchObject({
      outcome: 'aprobado',
      resolution: 'aprobar',
      resolutionNote: 'Llegó con el instructor',
    });
    const [session] = await f.attendanceRepo.list();
    expect(session).toMatchObject({
      studentId: ana.id,
      enteredAt: bogota('10:58'),
      entrySource: 'offline',
    });
    const audit = f.eventLog.entries.find(
      (e) => e.type === 'offline.review.resolved',
    );
    expect(audit).toMatchObject({
      actor: { type: 'user' },
      detail: {
        action: 'aprobar',
        reviewReason: 'OUTSIDE_WINDOW',
        note: 'Llegó con el instructor',
      },
    });
    expect(JSON.stringify(audit)).not.toContain('Student');
  });

  it('refuses to approve what only a correction or a discard can fix', async () => {
    const { f, snapshotId, pending } = await setup();
    await f.offline.handleBatch(
      DEVICE,
      f.batch([f.event(snapshotId, 'exit', 1, '10:40')]),
    );
    const event = await pending('EXIT_WITHOUT_ENTRY');
    await expect(
      f.review.resolve(event.id, { action: 'aprobar', reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'NOT_APPROVABLE' } });
    expect((await f.events.findById(DEVICE, event.id))?.outcome).toBe(
      'por_revisar',
    );
  });

  it('discards without touching any session', async () => {
    const { f, snapshotId, pending } = await setup();
    await lateEntry(f, snapshotId);
    const event = await pending('OUTSIDE_WINDOW');
    const item = await f.review.resolve(event.id, {
      action: 'descartar',
      reason: 'Error de lectura',
    });
    expect(item.record.outcome).toBe('descartado');
    expect(await f.attendanceRepo.list()).toEqual([]);
    expect(await f.review.count()).toBe(0);
  });

  it('corrects the hour inside the same day and applies the event with it', async () => {
    const { f, ana, snapshotId, pending } = await setup();
    await lateEntry(f, snapshotId);
    const event = await pending('OUTSIDE_WINDOW');

    const item = await f.review.resolve(event.id, {
      action: 'corregir',
      reason: 'El reloj iba adelantado',
      ts: bogota('10:08'),
    });

    expect(item.record).toMatchObject({
      outcome: 'corregido',
      correctedTs: bogota('10:08'),
    });
    expect((await f.attendanceRepo.list())[0]).toMatchObject({
      studentId: ana.id,
      enteredAt: bogota('10:08'),
    });
  });

  it('rejects a correction on another day or in the future', async () => {
    const { f, snapshotId, pending } = await setup();
    await lateEntry(f, snapshotId);
    const event = await pending('OUTSIDE_WINDOW');
    await expect(
      f.review.resolve(event.id, {
        action: 'corregir',
        reason: 'x',
        ts: bogota('10:08', '2026-11-01'),
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CORRECTION' } });
    await expect(
      f.review.resolve(event.id, {
        action: 'corregir',
        reason: 'x',
        ts: bogota('12:00'),
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CORRECTION' } });
    await expect(
      f.review.resolve(event.id, { action: 'corregir', reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'TS_REQUIRED' } });
  });

  it('answers 422 and keeps it pending when the corrected hour still conflicts', async () => {
    const { f, snapshotId, pending } = await setup();
    await lateEntry(f, snapshotId);
    const event = await pending('OUTSIDE_WINDOW');
    await expect(
      f.review.resolve(event.id, {
        action: 'corregir',
        reason: 'x',
        ts: bogota('10:59'),
      }),
    ).rejects.toMatchObject({
      response: { code: 'STILL_CONFLICT', reason: 'OUTSIDE_WINDOW' },
    });
    expect((await f.events.findById(DEVICE, event.id))?.outcome).toBe(
      'por_revisar',
    );
    expect(await f.attendanceRepo.list()).toEqual([]);
  });

  it('lets the second of two concurrent reviewers know it lost (409)', async () => {
    const { f, snapshotId, pending } = await setup();
    await lateEntry(f, snapshotId);
    const event = await pending('OUTSIDE_WINDOW');
    const results = await Promise.allSettled([
      f.review.resolve(event.id, { action: 'aprobar', reason: 'a' }),
      f.review.resolve(event.id, { action: 'aprobar', reason: 'b' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected');
    expect(lost).toMatchObject({
      reason: { response: { code: 'ALREADY_RESOLVED' } },
    });
    expect(await f.attendanceRepo.list()).toHaveLength(1);
  });

  it('approving an exit over a session the server closed makes it cerrada with the real exit', async () => {
    const { f, snapshotId, pending } = await setup();
    await f.offline.handleBatch(
      DEVICE,
      f.batch([f.event(snapshotId, 'entry', 1, '10:03')], { last: false }),
    );
    f.setNow(bogota('12:00'));
    await f.alarmService.tick(bogota('12:00'));
    await f.offline.handleBatch(
      DEVICE,
      f.batch([f.event(snapshotId, 'exit', 1, '11:50')]),
    );
    const event = await pending('SESSION_ALREADY_CLOSED');

    await f.review.resolve(event.id, {
      action: 'aprobar',
      reason: 'Salió a su hora',
    });

    expect((await f.attendanceRepo.list())[0]).toMatchObject({
      status: 'cerrada',
      exitSource: 'offline',
      exitedAt: bogota('11:50'),
    });
  });

  it('answers 404 for an unknown event and 409 for one already resolved', async () => {
    const { f, snapshotId, pending } = await setup();
    await expect(
      f.review.resolve(unix('10:00').toString().padStart(36, '0'), {
        action: 'descartar',
        reason: 'x',
      }),
    ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_FOUND' } });
    await lateEntry(f, snapshotId);
    const event = await pending('OUTSIDE_WINDOW');
    await f.review.resolve(event.id, { action: 'descartar', reason: 'x' });
    await expect(
      f.review.resolve(event.id, { action: 'descartar', reason: 'y' }),
    ).rejects.toMatchObject({ response: { code: 'ALREADY_RESOLVED' } });
  });

  it('publishes the new pending count', async () => {
    const { f, snapshotId, pending } = await setup();
    const seen: number[] = [];
    f.systemEvents.events.subscribe((e) => {
      if (e.type === 'offline.review') seen.push(e.data.pending);
    });
    await lateEntry(f, snapshotId);
    const event = await pending('OUTSIDE_WINDOW');
    await f.review.resolve(event.id, { action: 'descartar', reason: 'x' });
    expect(seen).toEqual([1, 0]);
  });
});
