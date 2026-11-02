import { describe, expect, it } from 'vitest';
import { formatBogota, formatBogotaDate, shortTime } from './time.js';

describe('Bogota display', () => {
  it('shifts UTC to UTC-5, across midnight too', () => {
    expect(formatBogota('2026-11-02T23:30:00.000Z')).toBe('2026-11-02 18:30');
    expect(formatBogota('2026-11-03T03:00:00.000Z')).toBe('2026-11-02 22:00');
    expect(formatBogotaDate('2026-11-03T04:59:00.000Z')).toBe('2026-11-02');
  });

  it('trims times to minutes', () => {
    expect(shortTime('18:30:00')).toBe('18:30');
  });
});
