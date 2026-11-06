import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import {
  byLabel,
  groupCells,
  groupColumns,
  groupOf,
  type GroupBy,
  type ReportContext,
} from './context.js';
import { pairKey, type Obligation } from './occurrences.js';
import { percent, type ReportRow, type ReportTable } from './table.js';

export interface AttendanceCounts {
  obligations: number;
  attended: number;
}

/** Pairs (student, occurrence) that have at least one session of any state. */
export function attendedPairs(
  sessions: readonly AttendanceSession[],
): Set<string> {
  return new Set(sessions.map((s) => pairKey(s.studentId, s.instanceId)));
}

/**
 * Absences and compliance per student, schedule or month. A session of
 * someone without an obligation (a manual entry) adds nothing here. Only
 * groups with at least one obligation appear.
 */
export function computeAttendance(
  obligations: readonly Obligation[],
  sessions: readonly AttendanceSession[],
  groupBy: GroupBy,
  ctx: ReportContext,
): ReportTable {
  const attended = attendedPairs(sessions);
  const groups = new Map<
    string,
    { label: string; key: string } & AttendanceCounts
  >();
  for (const o of obligations) {
    const { key, label } = groupOf(groupBy, o.studentId, o.instance, ctx);
    const g = groups.get(key) ?? { key, label, obligations: 0, attended: 0 };
    g.obligations++;
    if (attended.has(pairKey(o.studentId, o.instance.id))) g.attended++;
    groups.set(key, g);
  }
  const rows: ReportRow[] = [...groups.values()].sort(byLabel).map((g) => ({
    ...groupCells(groupBy, g.key, g.label, ctx),
    obligations: g.obligations,
    attended: g.attended,
    absences: g.obligations - g.attended,
    compliance: percent(g.attended, g.obligations),
  }));
  return {
    columns: [
      ...groupColumns(groupBy),
      { key: 'obligations', label: 'Obligaciones', type: 'int' },
      { key: 'attended', label: 'Asistidas', type: 'int' },
      { key: 'absences', label: 'Inasistencias', type: 'int' },
      { key: 'compliance', label: 'Cumplimiento (%)', type: 'percent' },
    ],
    rows,
    meta: {
      groupBy,
      obligations: obligations.length,
      attended: [...groups.values()].reduce((n, g) => n + g.attended, 0),
    },
  };
}
