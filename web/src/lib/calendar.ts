/**
 * Pure calendar logic of the date pickers. Days are `YYYY-MM-DD` strings (a
 * Bogota day) and all arithmetic is UTC at noon, so the zone of the browser
 * never shifts a day. "Today" is always injected by the caller.
 */
import type { ServiceException } from '@/api/types';

export const MONTHS = [
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

/** Monday first, as the grid. */
export const WEEKDAY_NAMES = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
] as const;

export interface DayBounds {
  /** First selectable day. */
  start: string;
  /** Last selectable day. */
  end: string;
}

export interface MonthCell {
  iso: string;
  inMonth: boolean;
}

export interface DayRange {
  from: string;
  to: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const parse = (day: string): Date => new Date(`${day}T12:00:00Z`);
const toIso = (date: Date): string => date.toISOString().slice(0, 10);

/** Whether `value` is a real `YYYY-MM-DD` calendar day. */
export function isValidDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const date = parse(value);
  return !Number.isNaN(date.getTime()) && toIso(date) === value;
}

/** Negative, zero or positive, like a sort comparator. */
export const compareDay = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export function addDays(day: string, amount: number): string {
  const date = parse(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return toIso(date);
}

/** Moves a day by whole months, clamping to the last day of the target month. */
export function addMonths(day: string, amount: number): string {
  const date = parse(day);
  const dayOfMonth = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  date.setUTCDate(Math.min(dayOfMonth, last));
  return toIso(date);
}

/** 0 (Monday) to 6 (Sunday). */
export const weekdayIndex = (day: string): number =>
  (parse(day).getUTCDay() + 6) % 7;

/** `YYYY-MM` of a day. */
export const monthOf = (day: string): string => day.slice(0, 7);

/** The 42 cells (6 weeks, Monday first) of a month; `month` is 0 to 11. */
export function monthGrid(year: number, month: number): MonthCell[] {
  const first = new Date(Date.UTC(year, month, 1, 12));
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, 1 - offset + index, 12));
    return { iso: toIso(date), inMonth: date.getUTCMonth() === month };
  });
}

/** The range with its ends in order (a single day is `a` twice). */
export function normalizeRange(a: string, b: string): DayRange {
  return compareDay(a, b) <= 0 ? { from: a, to: b } : { from: b, to: a };
}

/** Whether `day` lies outside the reference period. */
export const isDisabled = (day: string, bounds?: DayBounds): boolean =>
  bounds !== undefined && (day < bounds.start || day > bounds.end);

/** Every day covered by the service exceptions (`from` to `to`, both included). */
export function expandClosedDays(
  exceptions: ReadonlyArray<Pick<ServiceException, 'from' | 'to'>>,
): Set<string> {
  const days = new Set<string>();
  for (const { from, to } of exceptions) {
    if (!isValidDay(from) || !isValidDay(to)) continue;
    for (let day = from; day <= to; day = addDays(day, 1)) days.add(day);
  }
  return days;
}

export type ShortcutKind = 'today' | 'last7' | 'period' | 'clear';

/**
 * The range a shortcut sets, or `undefined` when it does not apply (the
 * period shortcut without a reference period).
 */
export function shortcutRange(
  kind: ShortcutKind,
  today: string,
  bounds?: DayBounds,
): DayRange | undefined {
  switch (kind) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'period':
      return bounds && { from: bounds.start, to: bounds.end };
    case 'clear':
      return { from: '', to: '' };
  }
}

/** `2 nov 2026`: a day for the closed field of a picker. */
export function formatPickerDay(day: string): string {
  const month = MONTHS[parse(day).getUTCMonth()] ?? '';
  const short = month === 'septiembre' ? 'sept' : month.slice(0, 3);
  return `${parse(day).getUTCDate()} ${short} ${day.slice(0, 4)}`;
}

/** `lunes 2 de noviembre de 2026`: the full accessible name of a day. */
export function fullDayName(day: string): string {
  const date = parse(day);
  return `${WEEKDAY_NAMES[weekdayIndex(day)]} ${date.getUTCDate()} de ${MONTHS[date.getUTCMonth()]} de ${date.getUTCFullYear()}`;
}
