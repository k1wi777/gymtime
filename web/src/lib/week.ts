import type { Schedule } from '@/api/types';

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export interface WeekDay {
  /** `YYYY-MM-DD` */
  date: string;
  /** 1 (Monday) to 7 (Sunday), as in the schedules. */
  weekday: number;
  name: (typeof DAY_NAMES)[number];
  /** Day of the month. */
  number: number;
}

const parse = (day: string): Date => new Date(`${day}T12:00:00Z`);
const iso = (date: Date): string => date.toISOString().slice(0, 10);

/** Monday to Sunday of the week that holds `day` (a `YYYY-MM-DD` Bogota day). */
export function weekOf(day: string): WeekDay[] {
  const base = parse(day);
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
  return DAY_NAMES.map((name, index) => {
    const current = new Date(monday);
    current.setUTCDate(monday.getUTCDate() + index);
    return {
      date: iso(current),
      weekday: index + 1,
      name,
      number: current.getUTCDate(),
    };
  });
}

/** `Semana del 2 al 8 de noviembre` (or across two months). */
export function weekTitle(days: readonly WeekDay[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return '';
  const month = (day: WeekDay) => MONTHS[parse(day.date).getUTCMonth()] ?? '';
  return month(first) === month(last)
    ? `Semana del ${first.number} al ${last.number} de ${month(last)}`
    : `Semana del ${first.number} de ${month(first)} al ${last.number} de ${month(last)}`;
}

/** Whether a schedule takes place on `day`: recurring by weekday, or one-off by date. */
export const occursOn = (schedule: Schedule, day: WeekDay): boolean =>
  schedule.weekday !== null
    ? schedule.weekday === day.weekday
    : schedule.date === day.date;

const hhmm = (time: string): string => time.slice(0, 5);

/** `19:05 – 20:05` */
export const timeRange = (schedule: Schedule): string =>
  `${hhmm(schedule.startTime)} – ${hhmm(schedule.endTime)}`;

export type DayPhase = 'past' | 'current' | 'upcoming';

/** Phase of a schedule today, given the Bogota `HH:mm` clock. */
export function phaseAt(schedule: Schedule, clock: string): DayPhase {
  if (clock >= hhmm(schedule.endTime)) return 'past';
  return clock >= hhmm(schedule.startTime) ? 'current' : 'upcoming';
}

/** Schedules of a day, ordered by start time. */
export const schedulesOn = (
  schedules: readonly Schedule[],
  day: WeekDay,
): Schedule[] =>
  schedules
    .filter((schedule) => occursOn(schedule, day))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
