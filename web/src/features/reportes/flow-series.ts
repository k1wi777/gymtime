import type { FlowReport } from '@/api/types';
import { formatDay } from '@/lib/time';
import type { BarDatum } from './charts/chart-types';
import { formatInt, formatPercent } from './format';

const WEEKDAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;
const SHORT_WEEKDAYS = [
  'Lun',
  'Mar',
  'Mié',
  'Jue',
  'Vie',
  'Sáb',
  'Dom',
] as const;

/** Fewest hours the hour chart shows, so a quiet range does not become one fat bar. */
export const MIN_VISIBLE_HOURS = 6;

export const hourLabel = (hour: number): string =>
  `${String(hour).padStart(2, '0')}:00`;

const entries = (n: number): string =>
  `${formatInt(n)} ${n === 1 ? 'entrada' : 'entradas'}`;
const share = (n: number, total: number): string =>
  total === 0 ? '0,0 %' : formatPercent((n / total) * 100);

/** First to last hour with entries (Bogota hours as the server sends them), at least 6 hours. */
export function visibleHours(counts: readonly number[]): [number, number] {
  const used = counts.flatMap((c, hour) => (c > 0 ? [hour] : []));
  if (used.length === 0) return [6, 6 + MIN_VISIBLE_HOURS - 1];
  let first = used[0] as number;
  let last = used[used.length - 1] as number;
  while (last - first + 1 < MIN_VISIBLE_HOURS) {
    if (last < 23) last++;
    else if (first > 0) first--;
    else break;
    if (last - first + 1 < MIN_VISIBLE_HOURS && first > 0) first--;
  }
  return [first, last];
}

export function hourSeries(flow: FlowReport): BarDatum[] {
  const peaks = new Set(flow.peaks.hours.map((p) => p.hour));
  const [first, last] = visibleHours(flow.byHour.map((b) => b.count));
  return flow.byHour
    .filter((b) => b.hour >= first && b.hour <= last)
    .map((b) => ({
      key: `h${b.hour}`,
      label: hourLabel(b.hour),
      value: b.count,
      peak: peaks.has(b.hour) && b.count > 0,
      tooltip: `${hourLabel(b.hour)}–${String(b.hour).padStart(2, '0')}:59 · ${entries(b.count)} (${share(b.count, flow.total)} del total)`,
    }));
}

export function weekdaySeries(flow: FlowReport): BarDatum[] {
  const peaks = new Set(flow.peaks.weekdays.map((p) => p.weekday));
  return flow.byWeekday.map((b) => ({
    key: `d${b.weekday}`,
    label: SHORT_WEEKDAYS[b.weekday - 1] ?? String(b.weekday),
    value: b.count,
    peak: peaks.has(b.weekday) && b.count > 0,
    tooltip: `${WEEKDAYS[b.weekday - 1]} · ${entries(b.count)} (${share(b.count, flow.total)} del total)`,
  }));
}

/** In a chart made only of peaks, the accent marks the highest one. */
const isTop = (count: number, counts: readonly number[]): boolean =>
  count === Math.max(...counts);

/** The busiest hours only, as bars sorted by hour. */
export function peakHoursSeries(flow: FlowReport): BarDatum[] {
  const counts = flow.peaks.hours.map((p) => p.count);
  return [...flow.peaks.hours]
    .sort((a, b) => a.hour - b.hour)
    .map((p) => ({
      key: `p${p.hour}`,
      label: hourLabel(p.hour),
      value: p.count,
      peak: isTop(p.count, counts),
      tooltip: `${hourLabel(p.hour)}–${String(p.hour).padStart(2, '0')}:59 · ${entries(p.count)} (${share(p.count, flow.total)} del total)`,
    }));
}

export function peakDatesSeries(flow: FlowReport): BarDatum[] {
  const counts = flow.peaks.dates.map((p) => p.count);
  return flow.peaks.dates.map((p) => ({
    key: `f${p.date}`,
    label: p.date.slice(5),
    value: p.count,
    peak: isTop(p.count, counts),
    tooltip: `${formatDay(p.date)} · ${entries(p.count)} (${share(p.count, flow.total)} del total)`,
  }));
}

/** "Entradas por hora; pico a las 07:00 con 54" for assistive technology. */
export function summarize(
  what: string,
  data: readonly BarDatum[],
  verb = 'pico',
): string {
  const top = data.reduce<BarDatum | null>(
    (best, d) => (best === null || d.value > best.value ? d : best),
    null,
  );
  return top && top.value > 0
    ? `${what}; ${verb} en ${top.label} con ${formatInt(top.value)}`
    : `${what}; sin datos en el rango`;
}
