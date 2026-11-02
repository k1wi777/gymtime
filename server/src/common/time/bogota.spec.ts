import {
  addDays,
  formatBogota,
  fromBogota,
  secondsOfDay,
  toBogotaParts,
  weekdayOf,
} from './bogota.js';

describe('bogota time helpers (R6)', () => {
  it('converts Bogota wall-clock to UTC and back', () => {
    const instant = fromBogota('2026-11-02', '18:30');
    expect(instant.toISOString()).toBe('2026-11-02T23:30:00.000Z');
    expect(toBogotaParts(instant)).toEqual({
      date: '2026-11-02',
      time: '18:30:00',
      weekday: 1,
    });
  });

  it('keeps the Bogota date across the UTC midnight', () => {
    const instant = new Date('2026-11-03T03:00:00.000Z');
    expect(toBogotaParts(instant).date).toBe('2026-11-02');
    expect(formatBogota(instant)).toBe('2026-11-02 22:00:00');
  });

  it('computes weekdays with Monday = 1 and Sunday = 7', () => {
    expect(weekdayOf('2026-11-02')).toBe(1);
    expect(weekdayOf('2026-11-08')).toBe(7);
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-11-30', 2)).toBe('2026-12-02');
  });

  it('measures seconds of day and rejects malformed input', () => {
    expect(secondsOfDay('01:00:30')).toBe(3630);
    expect(() => fromBogota('2026/11/02', '10:00')).toThrow();
    expect(() => fromBogota('2026-11-02', '10h')).toThrow();
  });
});
