import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import { toBogotaParts } from '../../common/time/bogota.js';
import { weekdayName } from './context.js';
import { percent, type ReportRow, type ReportTable } from './table.js';

export const DEFAULT_TOP = 3;
export const MAX_TOP = 10;

export interface HourBucket {
  hour: number;
  count: number;
}
export interface WeekdayBucket {
  weekday: number;
  count: number;
}
export interface DateBucket {
  date: string;
  count: number;
}

export interface FlowResult {
  total: number;
  distinctStudents: number;
  byHour: HourBucket[];
  byWeekday: WeekdayBucket[];
  peaks: {
    hours: HourBucket[];
    weekdays: WeekdayBucket[];
    dates: DateBucket[];
  };
}

/** Top N by count descending; ties go to the smaller value (stable and checkable). */
function top<T extends { count: number }>(
  buckets: readonly T[],
  n: number,
  value: (b: T) => string | number,
): T[] {
  return buckets
    .filter((b) => b.count > 0)
    .sort(
      (a, b) =>
        b.count - a.count ||
        (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0),
    )
    .slice(0, n);
}

/**
 * Entries (not simultaneous occupancy) per Bogota hour and weekday of the
 * entry instant, with the busiest hours, weekdays and dates.
 */
export function computeFlow(
  sessions: readonly AttendanceSession[],
  topN: number = DEFAULT_TOP,
): FlowResult {
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const byWeekday = Array.from({ length: 7 }, (_, i) => ({
    weekday: i + 1,
    count: 0,
  }));
  const byDate = new Map<string, number>();
  const students = new Set<string>();
  for (const s of sessions) {
    const p = toBogotaParts(s.enteredAt);
    (byHour[Number(p.time.slice(0, 2))] as HourBucket).count++;
    (byWeekday[p.weekday - 1] as WeekdayBucket).count++;
    byDate.set(p.date, (byDate.get(p.date) ?? 0) + 1);
    students.add(s.studentId);
  }
  const dates = [...byDate].map(([date, count]) => ({ date, count }));
  return {
    total: sessions.length,
    distinctStudents: students.size,
    byHour,
    byWeekday,
    peaks: {
      hours: top(byHour, topN, (b) => b.hour),
      weekdays: top(byWeekday, topN, (b) => b.weekday),
      dates: top(dates, topN, (b) => b.date),
    },
  };
}

export const hourLabel = (hour: number): string =>
  `${String(hour).padStart(2, '0')}:00`;

/** Long table (hours then weekdays) so JSON and CSV share one shape. */
export function flowTable(flow: FlowResult): ReportTable {
  const rows: ReportRow[] = [
    ...flow.byHour.map((b) => ({
      group: 'Hora',
      value: hourLabel(b.hour),
      count: b.count,
      share: percent(b.count, flow.total),
    })),
    ...flow.byWeekday.map((b) => ({
      group: 'Día de la semana',
      value: weekdayName(b.weekday),
      count: b.count,
      share: percent(b.count, flow.total),
    })),
  ];
  return {
    columns: [
      { key: 'group', label: 'Agrupación', type: 'text' },
      { key: 'value', label: 'Valor', type: 'text' },
      { key: 'count', label: 'Entradas', type: 'int' },
      { key: 'share', label: '% del total', type: 'percent' },
    ],
    rows,
    meta: {
      total: flow.total,
      distinctStudents: flow.distinctStudents,
    },
  };
}
