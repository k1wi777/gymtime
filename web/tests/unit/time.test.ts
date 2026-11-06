import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  bogotaDay,
  formatCountdown,
  formatDateTime,
  formatTime,
  formatTimeSeconds,
} from '@/lib/time';

describe('time (Bogota, R14)', () => {
  it('shows 10:00 for 15:00 UTC whatever the zone of the browser', () => {
    expect(formatTime('2026-11-02T15:00:00Z')).toBe('10:00');
    expect(formatTimeSeconds('2026-11-02T15:00:09Z')).toBe('10:00:09');
  });

  it('uses the 24-hour clock', () => {
    expect(formatTime('2026-11-02T23:30:00Z')).toBe('18:30');
  });

  it('gives the Bogota calendar day, which differs from the UTC one at night', () => {
    expect(bogotaDay('2026-11-03T02:00:00Z')).toBe('2026-11-02');
    expect(bogotaDay('2026-11-02T05:00:00Z')).toBe('2026-11-02');
    expect(bogotaDay('2026-11-02T04:59:00Z')).toBe('2026-11-01');
  });

  it('formats a date with its time in Spanish', () => {
    expect(formatDateTime('2026-11-02T15:05:00Z')).toMatch(/nov/i);
    expect(formatDateTime('2026-11-02T15:05:00Z')).toContain('10:05');
  });

  it('formats a countdown without going below zero', () => {
    expect(formatCountdown(3599)).toBe('59:59');
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(65.9)).toBe('1:05');
    expect(formatCountdown(-4)).toBe('0:00');
  });
});

describe('screens never format dates on their own', () => {
  const SRC = join(__dirname, '../../src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });

  it('only lib/time.ts uses toLocale* or Intl.DateTimeFormat', () => {
    const offenders = files(SRC)
      .filter(
        (file) => /\.(ts|tsx)$/.test(file) && !file.endsWith('lib/time.ts'),
      )
      .filter((file) =>
        /toLocale(Date|Time)?String|Intl\.DateTimeFormat/.test(
          readFileSync(file, 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
