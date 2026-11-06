import { addDays, weekdayOf } from '../../common/time/bogota.js';
import type { Schedule } from '../domain/schedule.js';
import type { Period } from './period.js';

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Bogota dates on which a schedule occurs within `window` (inclusive). The one
 * source of truth for creating, regenerating and repairing occurrences.
 *
 * - One-off schedule: its own date; periods and days without service never
 *   apply to it (E18-6).
 * - Recurring schedule of a period: every matching weekday of the period,
 *   except the days without service.
 * - Legacy recurring schedule (no period): every matching weekday in `window`.
 */
export function occurrenceDates(
  schedule: Pick<Schedule, 'weekday' | 'date'>,
  period: Pick<Period, 'startDate' | 'endDate'> | null,
  exceptions: readonly DateRange[],
  window: DateRange,
): string[] {
  if (schedule.date !== null) {
    return schedule.date >= window.from && schedule.date <= window.to
      ? [schedule.date]
      : [];
  }
  const from =
    period && period.startDate > window.from ? period.startDate : window.from;
  const to = period && period.endDate < window.to ? period.endDate : window.to;
  const dates: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (weekdayOf(day) !== schedule.weekday) continue;
    if (period && exceptions.some((e) => e.from <= day && day <= e.to)) {
      continue;
    }
    dates.push(day);
  }
  return dates;
}
