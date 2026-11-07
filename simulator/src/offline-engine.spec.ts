import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfflineEngine, type Snapshot } from './offline-engine.js';
import { OfflineQueue } from './offline-queue.js';

const START = 1_760_000_400;
const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  snapshotId: randomUUID(),
  generatedAt: START - 600,
  schedule: {
    scheduleId: 'sch-1',
    start: START,
    end: START + 3600,
    entryOpensAt: START - 300,
    entryClosesAt: START + 3300,
  },
  roster: [
    { slot: 1, name: 'Ana Gomez' },
    { slot: 2, name: 'Luis Mora' },
    { slot: 3, name: 'Eva Ruiz' },
  ],
  open: [2],
  exited: [3],
  limits: { queueMax: 500, batchMax: 50 },
  ...over,
});

function build(max = 500, over: Partial<Snapshot> = {}) {
  const queue = new OfflineQueue(null, max);
  const engine = new OfflineEngine(queue);
  engine.onSnapshot(snapshot(over));
  return { queue, engine };
}

describe('OfflineEngine (local decision)', () => {
  it('rejects without a snapshot or without an upcoming schedule', () => {
    const none = new OfflineEngine(new OfflineQueue(null));
    expect(none.scan(1, START)).toEqual({
      result: 'reject',
      reason: 'NO_SNAPSHOT',
    });
    const { engine } = build(500, { schedule: null });
    expect(engine.scan(1, START)).toEqual({
      result: 'reject',
      reason: 'NO_SCHEDULE',
    });
  });

  it('enters inside the window, exits when inside, refuses a second entry', () => {
    const { engine, queue } = build();
    const entry = engine.scan(1, START + 10);
    expect(entry).toMatchObject({ result: 'entry', name: 'Ana Gomez' });
    expect(engine.scan(1, START + 20)).toMatchObject({ result: 'exit' });
    expect(engine.scan(1, START + 30)).toEqual({
      result: 'reject',
      reason: 'ALREADY_EXITED',
    });
    expect(queue.peek(10).map((e) => e.type)).toEqual(['entry', 'exit']);
    expect(queue.peek(10).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('uses the snapshot state: slot 2 is inside, slot 3 already left', () => {
    const { engine } = build();
    expect(engine.scan(2, START + 5)).toMatchObject({ result: 'exit' });
    expect(engine.scan(3, START + 5)).toMatchObject({
      result: 'reject',
      reason: 'ALREADY_EXITED',
    });
  });

  it('refuses an entry before the window opens and after it closes', () => {
    const { engine } = build();
    expect(engine.scan(1, START - 301)).toMatchObject({
      reason: 'OUTSIDE_WINDOW',
    });
    expect(engine.scan(1, START + 3301)).toMatchObject({
      reason: 'OUTSIDE_WINDOW',
    });
  });

  it('queues an unknown fingerprint as informational', () => {
    const { engine, queue } = build();
    expect(engine.scan(99, START)).toMatchObject({ result: 'unknown' });
    expect(queue.peek(1)[0]).toMatchObject({ type: 'unknown' });
  });

  it('refuses with "queue full" and never drops an old event', () => {
    const { engine, queue } = build(2);
    engine.scan(1, START);
    engine.scan(1, START + 1);
    expect(queue.isFull).toBe(true);
    expect(engine.scan(99, START + 2)).toBeDefined();
    expect(queue.size).toBe(2);
    const refused = new OfflineEngine(queue).scan(2, START + 3);
    expect(refused).toEqual({ result: 'reject', reason: 'QUEUE_FULL' });
    expect(queue.peek(5).map((e) => e.type)).toEqual(['entry', 'exit']);
  });

  it('starts the local alarm at the end with people inside and closes it by exit', () => {
    const { engine, queue } = build();
    expect(engine.tick(START + 3599)).toBeNull();
    expect(engine.tick(START + 3600)).toMatch(/LOCAL ALARM ON/);
    expect(engine.alarmActive).toBe(true);
    engine.scan(2, START + 3700);
    expect(engine.alarmActive).toBe(false);
    const alarm = queue.peek(5).find((e) => e.type === 'alarm');
    expect(alarm).toMatchObject({
      ts: START + 3600,
      endTs: START + 3700,
      endedBy: 'all_exited',
    });
  });

  it('ends the local alarm by button, by timeout and when the link returns', () => {
    const a = build();
    a.engine.tick(START + 3600);
    a.engine.button(START + 3650);
    expect(a.queue.peek(5)[0]).toMatchObject({ endedBy: 'button' });

    const b = build();
    b.engine.tick(START + 3600);
    b.engine.tick(START + 3600 + 900);
    expect(b.queue.peek(5)[0]).toMatchObject({
      endedBy: 'timeout',
      endTs: START + 4500,
    });

    const c = build();
    c.engine.tick(START + 3600);
    c.engine.onReconnect();
    expect(c.queue.peek(5)[0]).toMatchObject({ endTs: null });
  });

  it('keeps the local state when a snapshot arrives with events queued', () => {
    const { engine, queue } = build();
    engine.scan(1, START);
    engine.onSnapshot(snapshot({ open: [], exited: [] }));
    expect(queue.state.open).toContain(1);
  });
});

describe('OfflineQueue file', () => {
  it('survives a restart, keeps seq and one JSON per line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-q-'));
    const file = join(dir, 'state.jsonl');
    try {
      const first = new OfflineQueue(file);
      const engine = new OfflineEngine(first);
      engine.onSnapshot(snapshot());
      engine.scan(1, START);
      const lines = readFileSync(file, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      lines.forEach((l) => expect(() => JSON.parse(l)).not.toThrow());

      const reborn = new OfflineQueue(file);
      expect(reborn.size).toBe(1);
      expect(reborn.state.open).toContain(1);
      const again = new OfflineEngine(reborn);
      again.scan(1, START + 5);
      expect(reborn.peek(5).map((e) => e.seq)).toEqual([1, 2]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
