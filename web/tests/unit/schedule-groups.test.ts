import { describe, expect, it } from 'vitest';
import {
  findSchedule,
  groupByWeekday,
  rangeLabel,
  scheduleSummary,
  weekdayOf,
} from '@/lib/schedule-groups';

const make = (
  id: string,
  weekday: number | null,
  startTime: string,
  date: string | null = null,
) => ({
  id,
  name: `H${id}`,
  weekday,
  date,
  startTime,
  endTime: '19:00:00',
});

describe('schedule groups', () => {
  const schedules = [
    make('a', 1, '18:00:00'),
    make('b', 1, '06:00:00'),
    make('c', 3, '07:00:00'),
    make('d', null, '10:00:00', '2026-11-07'), // a Saturday
    make('e', null, '10:00:00'),
  ];
  const groups = groupByWeekday(schedules);

  it('always returns the seven days, Monday first', () => {
    expect(groups.map((g) => g.label)).toEqual([
      'Lun',
      'Mar',
      'Mié',
      'Jue',
      'Vie',
      'Sáb',
      'Dom',
    ]);
    expect(groups[1]?.schedules).toEqual([]);
  });
  it('orders each day by start time', () => {
    expect(groups[0]?.schedules.map((s) => s.id)).toEqual(['b', 'a']);
  });
  it('groups a one-off schedule under the weekday of its date', () => {
    expect(weekdayOf(schedules[3]!)).toBe(6);
    expect(groups[5]?.schedules.map((s) => s.id)).toEqual(['d']);
  });
  it('leaves out a schedule with neither weekday nor date', () => {
    expect(groups.flatMap((g) => g.schedules).map((s) => s.id)).not.toContain(
      'e',
    );
  });
  it('finds a schedule by id with its day', () => {
    const found = findSchedule(groups, 'c');
    expect(found?.group.weekday).toBe(3);
    expect(found && scheduleSummary(found.group, found.schedule)).toBe(
      'Mié 07:00–19:00 · Hc',
    );
    expect(findSchedule(groups, 'zzz')).toBeUndefined();
  });
  it('writes the range without seconds', () => {
    expect(rangeLabel(schedules[0]!)).toBe('18:00–19:00');
  });
});
