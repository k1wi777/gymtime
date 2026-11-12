import { describe, expect, it } from 'vitest';
import {
  HOURS,
  isTime,
  joinTime,
  minuteOptions,
  parseTime,
} from '@/lib/time-select';

describe('time-select helpers', () => {
  it('lists 24 hours', () => {
    expect(HOURS).toHaveLength(24);
    expect(HOURS[0]).toBe('00');
    expect(HOURS[23]).toBe('23');
  });

  it('parses valid times and rejects invalid ones', () => {
    expect(parseTime('18:30')).toEqual({ hour: '18', minute: '30' });
    for (const bad of ['24:00', '9:5', '', '12:60', 'ab:cd']) {
      expect(parseTime(bad)).toBeUndefined();
      expect(isTime(bad)).toBe(false);
    }
    expect(isTime('00:00')).toBe(true);
  });

  it('offers minutes in steps of five and keeps an odd one in order', () => {
    expect(minuteOptions()).toHaveLength(12);
    expect(minuteOptions('10')).toHaveLength(12);
    const odd = minuteOptions('07');
    expect(odd).toHaveLength(13);
    expect(odd.indexOf('07')).toBe(odd.indexOf('05') + 1);
    expect(odd.indexOf('10')).toBe(odd.indexOf('07') + 1);
  });

  it('joins hour and minute', () => {
    expect(joinTime('08', '05')).toBe('08:05');
  });
});
