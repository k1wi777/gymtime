import { weekdayIndex } from './calendar';

/** What the schedule selector needs; `Schedule` and the report options fit it. */
export interface SelectableSchedule {
  id: string;
  name: string;
  /** 1 (Monday) to 7 (Sunday), or null for a one-off schedule. */
  weekday: number | null;
  /** Day of a one-off schedule (`YYYY-MM-DD`). */
  date?: string | null;
  startTime: string;
  endTime: string;
  /** Assigned students, when the list carries them. */
  students?: readonly unknown[];
}

export interface WeekdayGroup<T extends SelectableSchedule> {
  /** 1 (Monday) to 7 (Sunday). */
  weekday: number;
  /** `Lun` */
  label: string;
  /** `lunes` */
  longLabel: string;
  schedules: T[];
}

const SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const LONG = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
] as const;

/** Weekday (1 to 7) of a schedule: its own, or the one of its date. */
export function weekdayOf(schedule: SelectableSchedule): number | undefined {
  if (schedule.weekday !== null) return schedule.weekday;
  return schedule.date ? weekdayIndex(schedule.date) + 1 : undefined;
}

export const hhmm = (time: string): string => time.slice(0, 5);

/** `18:00–19:00` */
export const rangeLabel = (schedule: SelectableSchedule): string =>
  `${hhmm(schedule.startTime)}–${hhmm(schedule.endTime)}`;

/**
 * The seven weekdays (also the empty ones, with no schedules) with their
 * schedules ordered by start time. A schedule without weekday or date has no
 * day to sit under and is left out.
 */
export function groupByWeekday<T extends SelectableSchedule>(
  schedules: readonly T[],
): WeekdayGroup<T>[] {
  return SHORT.map((label, index) => ({
    weekday: index + 1,
    label,
    longLabel: LONG[index] ?? '',
    schedules: schedules
      .filter((schedule) => weekdayOf(schedule) === index + 1)
      .sort(
        (a, b) =>
          a.startTime.localeCompare(b.startTime) ||
          a.endTime.localeCompare(b.endTime) ||
          a.name.localeCompare(b.name),
      ),
  }));
}

export function findSchedule<T extends SelectableSchedule>(
  groups: readonly WeekdayGroup<T>[],
  id: string,
): { group: WeekdayGroup<T>; schedule: T } | undefined {
  for (const group of groups) {
    const schedule = group.schedules.find((item) => item.id === id);
    if (schedule) return { group, schedule };
  }
  return undefined;
}

/** `Lun 18:00–19:00 · Nombre`: the chosen schedule in the closed field. */
export function scheduleSummary(
  group: Pick<WeekdayGroup<SelectableSchedule>, 'label'>,
  schedule: SelectableSchedule,
): string {
  return `${group.label} ${rangeLabel(schedule)} · ${schedule.name}`;
}

export interface DayFilterOption {
  /** 1 (Monday) to 7 (Sunday), or null for «Todos». */
  weekday: number | null;
  /** `Lun`, or `Todos` */
  label: string;
  /** `lunes`, or `todos` */
  longLabel: string;
  count: number;
}

/**
 * Pills of the day filter: only the weekdays that have schedules, Monday to
 * Sunday with their count, and «Todos» (the total) at the end.
 */
export function dayFilterOptions(
  schedules: readonly SelectableSchedule[],
): DayFilterOption[] {
  const days = groupByWeekday(schedules)
    .filter((group) => group.schedules.length > 0)
    .map((group) => ({
      weekday: group.weekday,
      label: group.label,
      longLabel: group.longLabel,
      count: group.schedules.length,
    }));
  if (days.length === 0) return [];
  const total = days.reduce((sum, day) => sum + day.count, 0);
  return [
    ...days,
    { weekday: null, label: 'Todos', longLabel: 'todos', count: total },
  ];
}

/** First weekday (Monday to Sunday) with schedules, or null if there are none. */
export function firstDayWithSchedules(
  schedules: readonly SelectableSchedule[],
): number | null {
  return (
    groupByWeekday(schedules).find((group) => group.schedules.length > 0)
      ?.weekday ?? null
  );
}

/** Schedules of one weekday, ordered by start time. */
export function filterByDay<T extends SelectableSchedule>(
  schedules: readonly T[],
  weekday: number,
): T[] {
  return groupByWeekday(schedules)[weekday - 1]?.schedules ?? [];
}
