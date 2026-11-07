import { randomUUID } from 'node:crypto';
import type { StudentsRepository } from '../../students/domain/students.repository.js';
import type { NewOfflineEvent } from '../domain/offline-event.js';
import type { OfflineEventsRepository } from '../domain/offline-events.repository.js';
import type { OfflineSnapshotsRepository } from '../domain/offline-snapshots.repository.js';

export interface OfflineRepositories {
  events: OfflineEventsRepository;
  snapshots: OfflineSnapshotsRepository;
  students: StudentsRepository;
  /** Creates the device row (Prisma needs it for the foreign keys). */
  ensureDevice: (deviceId: string) => Promise<void>;
}

const DEVICE = 'esp32-contract';
const T0 = new Date('2026-03-02T11:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

const newEvent = (over: Partial<NewOfflineEvent> = {}): NewOfflineEvent => ({
  deviceId: DEVICE,
  id: randomUUID(),
  seq: 1,
  ts: T0,
  type: 'entry',
  slot: 1,
  snapshotId: randomUUID(),
  batchId: randomUUID(),
  receivedAt: minutes(60),
  ...over,
});

/**
 * Contract of the offline repositories. The factory returns empty
 * repositories each time; Prisma and memory must agree (V2 and V15).
 */
export function describeOfflineRepositories(
  name: string,
  factory: () => Promise<OfflineRepositories>,
) {
  describe(`offline repositories: ${name}`, () => {
    async function world() {
      const repos = await factory();
      await repos.ensureDevice(DEVICE);
      const ana = await repos.students.create({
        document: `O-${name}-1`,
        name: 'Ana',
        program: null,
        email: null,
        phone: null,
        displayName: 'Ana',
      });
      return { ...repos, ana };
    }

    it('insertIfAbsent flags new events and returns the stored one for repeats', async () => {
      const { events } = await world();
      const first = newEvent();
      const [a] = await events.insertIfAbsent([first]);
      expect(a).toMatchObject({
        isNew: true,
        record: { id: first.id, outcome: 'pendiente', ts: T0 },
      });
      const again = await events.insertIfAbsent([
        { ...first, seq: 99 },
        newEvent(),
      ]);
      expect(again.map((r) => r.isNew)).toEqual([false, true]);
      expect(again[0]?.record.seq).toBe(1);
    });

    it('settle decides a pending event once', async () => {
      const { events, ana } = await world();
      const event = newEvent();
      await events.insertIfAbsent([event]);
      const settled = await events.settle(DEVICE, event.id, {
        outcome: 'por_revisar',
        reviewReason: 'OUTSIDE_WINDOW',
        studentId: ana.id,
      });
      expect(settled).toMatchObject({
        outcome: 'por_revisar',
        reviewReason: 'OUTSIDE_WINDOW',
        studentId: ana.id,
      });
      expect(
        await events.settle(DEVICE, event.id, { outcome: 'applied' }),
      ).toBeNull();
      expect((await events.findById(DEVICE, event.id))?.outcome).toBe(
        'por_revisar',
      );
      expect(await events.findById(DEVICE, randomUUID())).toBeNull();
    });

    it('lastAppliedTs only counts events already applied', async () => {
      const { events, ana } = await world();
      const [applied, pending, review] = [
        newEvent({ ts: minutes(10) }),
        newEvent({ ts: minutes(20) }),
        newEvent({ ts: minutes(30) }),
      ];
      await events.insertIfAbsent([applied, pending, review]);
      expect(await events.lastAppliedTs(ana.id)).toBeNull();
      await events.settle(DEVICE, applied.id, {
        outcome: 'applied',
        studentId: ana.id,
      });
      await events.settle(DEVICE, review.id, {
        outcome: 'por_revisar',
        reviewReason: 'DUPLICATE_ENTRY',
        studentId: ana.id,
      });
      expect(await events.lastAppliedTs(ana.id)).toEqual(minutes(10));
    });

    it('list filters by outcome and window, oldest first, with the total', async () => {
      const { events } = await world();
      const batch = [3, 1, 2].map((n) => newEvent({ ts: minutes(n), seq: n }));
      await events.insertIfAbsent(batch);
      for (const e of batch.slice(0, 2)) {
        await events.settle(DEVICE, e.id, {
          outcome: 'por_revisar',
          reviewReason: 'OUT_OF_ORDER',
        });
      }
      const pending = await events.list({ outcomes: ['por_revisar'] });
      expect(pending.total).toBe(2);
      expect(pending.items.map((e) => e.ts)).toEqual([minutes(1), minutes(3)]);
      const page = await events.list({ limit: 1, offset: 1 });
      expect(page.total).toBe(3);
      expect(page.items.map((e) => e.ts)).toEqual([minutes(2)]);
      const window = await events.list({ from: minutes(2), to: minutes(3) });
      expect(window.total).toBe(2);
    });

    it('countByOutcome groups inside the window', async () => {
      const { events } = await world();
      const [a, b, c] = [1, 2, 3].map((n) => newEvent({ ts: minutes(n) }));
      await events.insertIfAbsent([a!, b!, c!]);
      await events.settle(DEVICE, a!.id, { outcome: 'applied' });
      await events.settle(DEVICE, b!.id, {
        outcome: 'por_revisar',
        reviewReason: 'TS_FUTURE',
      });
      expect(await events.countByOutcome({})).toEqual({
        applied: 1,
        por_revisar: 1,
        pendiente: 1,
      });
      expect(await events.countByOutcome({ from: minutes(2) })).toEqual({
        por_revisar: 1,
        pendiente: 1,
      });
    });

    it('resolve works for exactly one of two concurrent callers', async () => {
      const { events, ana } = await world();
      const event = newEvent();
      await events.insertIfAbsent([event]);
      await events.settle(DEVICE, event.id, {
        outcome: 'por_revisar',
        reviewReason: 'OUTSIDE_WINDOW',
        studentId: ana.id,
      });
      const data = {
        outcome: 'descartado' as const,
        resolution: 'descartar' as const,
        resolvedBy: null,
        resolvedAt: minutes(120),
        resolutionNote: 'error de lectura',
      };
      const results = await Promise.all([
        events.resolve(DEVICE, event.id, data),
        events.resolve(DEVICE, event.id, data),
      ]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await events.findById(DEVICE, event.id)).toMatchObject({
        outcome: 'descartado',
        resolution: 'descartar',
        resolutionNote: 'error de lectura',
      });
    });

    it('stores a snapshot per device and purges the old ones', async () => {
      const { snapshots } = await world();
      const id = randomUUID();
      const record = {
        id,
        deviceId: DEVICE,
        scheduleId: null,
        roster: { 1: randomUUID(), 7: randomUUID() },
        createdAt: minutes(0),
      };
      await snapshots.save(record);
      expect(await snapshots.find(DEVICE, id)).toEqual(record);
      expect(await snapshots.find('other-device', id)).toBeNull();
      expect(await snapshots.purgeOlderThan(minutes(-1))).toBe(0);
      expect(await snapshots.purgeOlderThan(minutes(1))).toBe(1);
      expect(await snapshots.find(DEVICE, id)).toBeNull();
    });
  });
}
