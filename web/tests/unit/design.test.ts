import { avatarTone, initialsOf } from '@/lib/display';
import type { Schedule } from '@/api/types';
import { formatLongDay } from '@/lib/time';
import {
  occursOn,
  phaseAt,
  schedulesOn,
  timeRange,
  weekOf,
  weekTitle,
} from '@/lib/week';

describe('avatars (R11)', () => {
  it('takes the initials of the first and last word', () => {
    expect(initialsOf('Laura Martínez')).toBe('LM');
    expect(initialsOf('  juan   carlos  díaz ')).toBe('JD');
    expect(initialsOf('Esteban')).toBe('E');
    expect(initialsOf('')).toBe('');
  });

  it('gives the same tone to the same id, always between 1 and 6', () => {
    const ids = ['a', 'b', 'c', '22222222-2222-4222-8222-222222222222', 'zzz'];
    for (const id of ids) {
      expect(avatarTone(id)).toBe(avatarTone(id));
      expect(avatarTone(id)).toBeGreaterThanOrEqual(1);
      expect(avatarTone(id)).toBeLessThanOrEqual(6);
    }
  });
});

describe('week of the schedules screen (R10)', () => {
  const schedule = (over: Partial<Schedule>): Schedule =>
    ({
      id: 's',
      name: 'Grupo',
      weekday: null,
      date: null,
      startTime: '19:05:00',
      endTime: '20:05:00',
      students: [],
      upcoming: [],
      ...over,
    }) as Schedule;

  it('runs Monday to Sunday around a day', () => {
    const days = weekOf('2026-11-07'); // Saturday
    expect(days.map((d) => d.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(days.map((d) => d.name).join(' ')).toBe(
      'Lun Mar Mié Jue Vie Sáb Dom',
    );
    expect(weekTitle(days)).toBe('Semana del 2 al 8 de noviembre');
    expect(weekTitle(weekOf('2026-11-30'))).toBe(
      'Semana del 30 de noviembre al 6 de diciembre',
    );
  });

  it('places recurring schedules by weekday and one-off ones by date', () => {
    const days = weekOf('2026-11-07');
    const saturday = days[5]!;
    const monday = days[0]!;
    const recurring = schedule({ weekday: 6 });
    const oneOff = schedule({
      id: 'o',
      date: '2026-11-02',
      startTime: '08:00:00',
    });
    expect(occursOn(recurring, saturday)).toBe(true);
    expect(occursOn(recurring, monday)).toBe(false);
    expect(occursOn(oneOff, monday)).toBe(true);
    expect(schedulesOn([recurring, oneOff], monday).map((s) => s.id)).toEqual([
      'o',
    ]);
    expect(timeRange(recurring)).toBe('19:05 – 20:05');
  });

  it('tells whether a schedule is past, running or upcoming', () => {
    const s = schedule({});
    expect(phaseAt(s, '18:00')).toBe('upcoming');
    expect(phaseAt(s, '19:05')).toBe('current');
    expect(phaseAt(s, '20:05')).toBe('past');
  });

  it('writes the long day in Bogota time', () => {
    expect(formatLongDay('2026-11-08T00:10:00.000Z')).toBe(
      'sábado 7 de noviembre',
    );
  });
});
