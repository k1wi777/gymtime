import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import {
  byLabel,
  groupCells,
  groupColumns,
  groupOf,
  type GroupBy,
  type ReportContext,
} from './context.js';
import { average, percent, type ReportRow, type ReportTable } from './table.js';

/**
 * Whole minutes late of a fingerprint entry (0 when on time or early). A
 * second short of a minute is not late: late means 1 or more full minutes.
 */
export function delayMinutes(enteredAt: Date, startsAt: Date): number {
  return Math.floor(
    Math.max(0, enteredAt.getTime() - startsAt.getTime()) / 60_000,
  );
}

/**
 * Late arrivals per student or schedule. Only fingerprint entries count: a
 * manual entry carries the time of the registration, not of the scan, so it
 * is counted apart and never judged late.
 */
export function computeLate(
  sessions: readonly AttendanceSession[],
  groupBy: Exclude<GroupBy, 'month'>,
  ctx: ReportContext,
): ReportTable {
  const groups = new Map<
    string,
    {
      key: string;
      label: string;
      entries: number;
      late: number;
      lateMinutes: number;
      manual: number;
    }
  >();
  for (const s of sessions) {
    const instance = ctx.instances.get(s.instanceId);
    if (!instance) continue;
    const { key, label } = groupOf(groupBy, s.studentId, instance, ctx);
    const g = groups.get(key) ?? {
      key,
      label,
      entries: 0,
      late: 0,
      lateMinutes: 0,
      manual: 0,
    };
    if (s.entrySource === 'manual') g.manual++;
    else {
      g.entries++;
      const minutes = delayMinutes(s.enteredAt, instance.startsAt);
      if (minutes >= 1) {
        g.late++;
        g.lateMinutes += minutes;
      }
    }
    groups.set(key, g);
  }
  const rows: ReportRow[] = [...groups.values()].sort(byLabel).map((g) => ({
    ...groupCells(groupBy, g.key, g.label, ctx),
    entries: g.entries,
    late: g.late,
    lateShare: percent(g.late, g.entries),
    averageDelay: average(g.lateMinutes, g.late),
    manual: g.manual,
  }));
  return {
    columns: [
      ...groupColumns(groupBy),
      { key: 'entries', label: 'Entradas por huella', type: 'int' },
      { key: 'late', label: 'Llegadas tarde', type: 'int' },
      { key: 'lateShare', label: 'Tarde (%)', type: 'percent' },
      { key: 'averageDelay', label: 'Retraso promedio (min)', type: 'decimal' },
      { key: 'manual', label: 'Entradas manuales', type: 'int' },
    ],
    rows,
    meta: { groupBy },
  };
}
