import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import type { ReportContext } from './context.js';
import { attendedPairs } from './attendance.js';
import { pairKey, type Obligation } from './occurrences.js';
import { percent } from './table.js';

export interface RangeSummary {
  /** Entries (sessions of any state) whose occurrence falls in the range. */
  entries: number;
  obligations: number;
  attended: number;
  /** 0-100 with one decimal; null without obligations. */
  compliance: number | null;
}

/** Attendance of the occurrences dated in [from, to] (Bogota dates, inclusive). */
export function summarizeRange(
  obligations: readonly Obligation[],
  sessions: readonly AttendanceSession[],
  ctx: ReportContext,
  from: string,
  to: string,
): RangeSummary {
  const inRange = (instanceId: string): boolean => {
    const date = ctx.instances.get(instanceId)?.date;
    return date !== undefined && date >= from && date <= to;
  };
  const attended = attendedPairs(sessions);
  const owed = obligations.filter(
    (o) => o.instance.date >= from && o.instance.date <= to,
  );
  const done = owed.filter((o) =>
    attended.has(pairKey(o.studentId, o.instance.id)),
  ).length;
  return {
    entries: sessions.filter((s) => inRange(s.instanceId)).length,
    obligations: owed.length,
    attended: done,
    compliance: percent(done, owed.length),
  };
}
