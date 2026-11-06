import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import {
  byLabel,
  groupCells,
  groupColumns,
  groupOf,
  type GroupBy,
  type ReportContext,
} from './context.js';
import { average, type ReportRow, type ReportTable } from './table.js';

/** Minutes between entry and exit of a closed session; null otherwise. */
export function stayMinutes(session: AttendanceSession): number | null {
  if (session.status !== 'cerrada' || session.exitedAt === null) return null;
  return (session.exitedAt.getTime() - session.enteredAt.getTime()) / 60_000;
}

/**
 * Average stay of the closed sessions. Unregistered and still-open sessions
 * are counted apart and never enter the average (their exit is unknown).
 */
export function computeStay(
  sessions: readonly AttendanceSession[],
  groupBy: GroupBy,
  ctx: ReportContext,
): ReportTable {
  const groups = new Map<
    string,
    {
      key: string;
      label: string;
      closed: number;
      minutes: number;
      unregistered: number;
      open: number;
    }
  >();
  for (const s of sessions) {
    const instance = ctx.instances.get(s.instanceId);
    if (!instance) continue;
    const { key, label } = groupOf(groupBy, s.studentId, instance, ctx);
    const g = groups.get(key) ?? {
      key,
      label,
      closed: 0,
      minutes: 0,
      unregistered: 0,
      open: 0,
    };
    const minutes = stayMinutes(s);
    if (minutes !== null) {
      g.closed++;
      g.minutes += minutes;
    } else if (s.status === 'no_registrada') g.unregistered++;
    else if (s.status === 'abierta') g.open++;
    groups.set(key, g);
  }
  const rows: ReportRow[] = [...groups.values()].sort(byLabel).map((g) => ({
    ...groupCells(groupBy, g.key, g.label, ctx),
    closed: g.closed,
    average: average(g.minutes, g.closed),
    unregistered: g.unregistered,
    open: g.open,
  }));
  return {
    columns: [
      ...groupColumns(groupBy),
      { key: 'closed', label: 'Sesiones cerradas', type: 'int' },
      { key: 'average', label: 'Permanencia promedio (min)', type: 'decimal' },
      { key: 'unregistered', label: 'Sin salida registrada', type: 'int' },
      { key: 'open', label: 'Abiertas', type: 'int' },
    ],
    rows,
    meta: { groupBy },
  };
}
