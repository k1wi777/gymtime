import { describe, expect, it } from 'vitest';
import {
  ReaderSimulator,
  describeSchedule,
  formatBogota,
  type SyncPayload,
} from './reader-simulator.js';

const sync = (
  syncId: string,
  index: number,
  total: number,
  slots: number[],
): SyncPayload => ({
  syncId,
  chunk: { index, total },
  templates: slots.map((slot) => ({
    slot,
    template: Buffer.from(`t${slot}-${syncId}`).toString('base64'),
  })),
});

describe('ReaderSimulator (R23, R24)', () => {
  it('accumulates the chunks of one sync keeping the slot map', () => {
    const reader = new ReaderSimulator();
    expect(reader.onSync(sync('a', 1, 2, [1, 2]))).toEqual({
      slots: [1, 2],
      total: 2,
      cleared: true,
    });
    expect(reader.onSync(sync('a', 2, 2, [3]))).toEqual({
      slots: [3],
      total: 3,
      cleared: false,
    });
    expect(reader.count).toBe(3);
    expect(reader.slots).toEqual([1, 2, 3]);
    expect(reader.templateAt(3)).toBe(Buffer.from('t3-a').toString('base64'));
  });

  it('wipes everything when a new syncId arrives', () => {
    const reader = new ReaderSimulator();
    reader.onSync(sync('a', 1, 1, [1, 2, 3]));
    const outcome = reader.onSync(sync('b', 1, 1, [1]));
    expect(outcome).toMatchObject({ cleared: true, total: 1 });
    expect(reader.slots).toEqual([1]);
    expect(reader.templateAt(1)).toBe(Buffer.from('t1-b').toString('base64'));
  });

  it('is idempotent for a retried chunk of the same sync', () => {
    const reader = new ReaderSimulator();
    reader.onSync(sync('a', 1, 2, [1, 2]));
    reader.onSync(sync('a', 2, 2, [3]));
    reader.onSync(sync('a', 2, 2, [3]));
    expect(reader.count).toBe(3);
  });

  it('empties the reader with an empty single chunk', () => {
    const reader = new ReaderSimulator();
    reader.onSync(sync('a', 1, 1, [1, 2]));
    reader.onSync(sync('b', 1, 1, []));
    expect(reader.count).toBe(0);
  });

  it('stores the schedule and shows it in Bogota time', () => {
    const reader = new ReaderSimulator();
    const schedule = {
      scheduleId: 's1',
      start: Date.parse('2026-11-02T15:00:00Z') / 1000,
      end: Date.parse('2026-11-02T16:00:00Z') / 1000,
      entryOpensAt: Date.parse('2026-11-02T14:50:00Z') / 1000,
      entryClosesAt: Date.parse('2026-11-02T15:55:00Z') / 1000,
    };
    expect(reader.currentSchedule).toBeNull();
    reader.onSchedule(schedule);
    expect(reader.currentSchedule).toEqual(schedule);
    expect(describeSchedule(schedule)).toBe(
      'schedule s1: 2026-11-02 10:00:00 to 11:00:00, entry 09:50:00 to 10:55:00 (Bogota)',
    );
    expect(formatBogota(Date.parse('2026-11-03T03:00:00Z') / 1000)).toBe(
      '2026-11-02 22:00:00',
    );
  });
});
