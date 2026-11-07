import { parseServerMessage } from '@gymtime/shared';
import type { SyncedEvent } from '../sync/sync.service.js';
import { DEVICE, buildOfflineFixture, bogota } from './testing.js';

async function setup() {
  const f = buildOfflineFixture();
  const { schedule, students } = await f.world(['1', '2', '3']);
  const slots = students.map((s, i) => ({ slot: i + 1, studentId: s.id }));
  const occurrence = (await f.instancesOf())[0]!;
  const synced: SyncedEvent = {
    deviceId: DEVICE,
    slots,
    schedule: {
      scheduleId: schedule.schedule.id,
      instanceId: occurrence.id,
      startsAt: bogota('10:00'),
      endsAt: bogota('11:00'),
      entryOpensAt: bogota('09:50'),
      entryClosesAt: bogota('10:55'),
    },
  };
  const sent = () => f.link.sent.filter((m) => m.type === 'offline.snapshot');
  return { f, students, synced, sent, occurrence };
}

describe('OfflineSnapshotService (R1, R4, R9)', () => {
  it('never sends to a reader without the offline capability (v0)', async () => {
    const { f, synced, sent } = await setup();
    await f.devices.markOnline(DEVICE, 'fw', bogota('11:30'));
    await f.snapshotService.onSynced(synced);
    expect(sent()).toEqual([]);
  });

  it('sends the schedule, roster, who is inside and who left, and passes its schema', async () => {
    const { f, students, synced, sent, occurrence } = await setup();
    await f.devices.markOnline(DEVICE, 'fw', bogota('11:30'), {
      capabilities: ['offline'],
    });
    await f.attendanceRepo.create({
      studentId: students[1]!.id,
      instanceId: occurrence.id,
      enteredAt: bogota('10:05'),
      entrySource: 'device',
    });
    const left = await f.attendanceRepo.create({
      studentId: students[2]!.id,
      instanceId: occurrence.id,
      enteredAt: bogota('10:05'),
      entrySource: 'device',
    });
    await f.attendanceRepo.close(left.id, {
      exitedAt: bogota('10:40'),
      exitSource: 'device',
    });

    await f.snapshotService.onSynced(synced);

    const [message] = sent();
    expect(parseServerMessage(JSON.stringify(message))).toMatchObject({
      ok: true,
    });
    expect(message?.payload).toMatchObject({
      schedule: {
        scheduleId: synced.schedule?.scheduleId,
        start: Math.floor(bogota('10:00').getTime() / 1000),
        entryClosesAt: Math.floor(bogota('10:55').getTime() / 1000),
      },
      roster: [
        { slot: 1, name: 'Student 1' },
        { slot: 2, name: 'Student 2' },
        { slot: 3, name: 'Student 3' },
      ],
      open: [2],
      exited: [3],
      limits: { queueMax: 500, batchMax: 50 },
    });
  });

  it('stores ids, not names, and can be found by the events that cite it', async () => {
    const { f, students, synced, sent } = await setup();
    await f.devices.markOnline(DEVICE, 'fw', bogota('11:30'), {
      capabilities: ['offline'],
    });
    await f.snapshotService.onSynced(synced);
    const id = (sent()[0]?.payload as { snapshotId: string }).snapshotId;
    const stored = await f.snapshots.find(DEVICE, id);
    expect(stored?.roster).toEqual({
      1: students[0]!.id,
      2: students[1]!.id,
      3: students[2]!.id,
    });
    expect(JSON.stringify(stored)).not.toContain('Student');
  });

  it('sends no schedule when there is none', async () => {
    const { f, synced, sent } = await setup();
    await f.devices.markOnline(DEVICE, 'fw', bogota('11:30'), {
      capabilities: ['offline'],
    });
    await f.snapshotService.onSynced({ ...synced, schedule: null });
    expect(sent()[0]?.payload).toMatchObject({ schedule: null, exited: [] });
  });

  it('purges snapshots older than the retention', async () => {
    const { f, synced } = await setup();
    await f.devices.markOnline(DEVICE, 'fw', bogota('11:30'), {
      capabilities: ['offline'],
    });
    const old = await f.snapshotOf(null, {}, bogota('09:00', '2026-10-01'));
    await f.snapshotService.onSynced(synced);
    expect(await f.snapshots.find(DEVICE, old)).toBeNull();
  });

  describe('with events still queued', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    async function queued() {
      const s = await setup();
      await s.f.devices.markOnline(DEVICE, 'fw', bogota('11:30'), {
        capabilities: ['offline'],
        queued: 12,
      });
      await s.f.snapshotService.onSynced(s.synced);
      return s;
    }

    it('waits for the last batch', async () => {
      const { f, sent } = await queued();
      expect(sent()).toEqual([]);
      await f.snapshotService.onBatchProcessed(DEVICE, false);
      expect(sent()).toEqual([]);
      await f.snapshotService.onBatchProcessed(DEVICE, true);
      expect(sent()).toHaveLength(1);
    });

    it('or for the maximum wait', async () => {
      const { sent } = await queued();
      await vi.advanceTimersByTimeAsync(59_000);
      expect(sent()).toEqual([]);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(sent()).toHaveLength(1);
    });

    it('does not wait again once the queue arrived on this connection', async () => {
      const { f, synced, sent } = await queued();
      await f.snapshotService.onBatchProcessed(DEVICE, true);
      await f.snapshotService.onSynced(synced);
      expect(sent()).toHaveLength(2);
    });

    it('a last batch that arrives before the sync releases the next snapshot at once', async () => {
      const s = await setup();
      await s.f.devices.markOnline(DEVICE, 'fw', bogota('11:30'), {
        capabilities: ['offline'],
        queued: 3,
      });
      await s.f.snapshotService.onBatchProcessed(DEVICE, true);
      await s.f.snapshotService.onSynced(s.synced);
      expect(s.sent()).toHaveLength(1);
    });
  });
});
