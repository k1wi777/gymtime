import type { RejectReason } from '@gymtime/shared';
import type { RelevantOccurrence } from '../../schedules/instances.service.js';
import type { Student } from '../../students/domain/student.js';
import type { AttendanceSession } from './attendance-session.js';

export interface DecisionInput {
  /** Student resolved from the slot; null when the slot is unassigned. */
  student: Student | null;
  /** Server instant of the scan (R2). */
  at: Date;
  /** Occurrences whose entry window is open at `at`. */
  activeOccurrences: RelevantOccurrence[];
  openSession: AttendanceSession | null;
  /** Instances where the student already has a closed session. */
  closedInstanceIds: readonly string[];
}

export type Decision =
  | { kind: 'entry'; occurrence: RelevantOccurrence }
  | { kind: 'exit'; session: AttendanceSession }
  | { kind: 'denied'; reason: RejectReason };

/**
 * Pure entry/exit decision. The order of the checks is part of the contract
 * (R5-R7): an open session always wins, so an exit is never blocked by the end
 * of the schedule or a later deactivation.
 */
export function decide(input: DecisionInput): Decision {
  const { student, at, openSession } = input;
  if (!student) return { kind: 'denied', reason: 'UNKNOWN_SLOT' };
  if (openSession) return { kind: 'exit', session: openSession };
  if (!student.active) return { kind: 'denied', reason: 'STUDENT_INACTIVE' };
  if (input.activeOccurrences.length === 0)
    return { kind: 'denied', reason: 'NO_ACTIVE_SCHEDULE' };

  const mine = input.activeOccurrences.filter((o) =>
    o.studentIds.includes(student.id),
  );
  if (mine.length === 0) return { kind: 'denied', reason: 'NOT_IN_SCHEDULE' };

  const applicable = pickApplicable(mine, at);
  // Only this occurrence counts: a closed session in another schedule does
  // not block entering a later one (R6, R8).
  if (input.closedInstanceIds.includes(applicable.instance.id))
    return { kind: 'denied', reason: 'ALREADY_EXITED' };
  if (at >= applicable.window.closesAt)
    return { kind: 'denied', reason: 'OUTSIDE_ENTRY_WINDOW' };
  return { kind: 'entry', occurrence: applicable };
}

/**
 * Same rule as `InstancesService.resolveForStudent`: the latest occurrence
 * with entry open, or the earliest in progress when none is open.
 */
function pickApplicable(
  occurrences: RelevantOccurrence[],
  at: Date,
): RelevantOccurrence {
  const open = occurrences.filter((o) => at < o.window.closesAt);
  const latestWins = open.length > 0;
  const pool = latestWins ? open : occurrences;
  return pool.reduce((best, current) => {
    const starts =
      current.instance.startsAt.getTime() - best.instance.startsAt.getTime();
    const wins = latestWins
      ? starts > 0 || (starts === 0 && current.instance.id > best.instance.id)
      : starts < 0 || (starts === 0 && current.instance.id < best.instance.id);
    return wins ? current : best;
  });
}
