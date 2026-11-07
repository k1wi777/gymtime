import type { OfflineReviewReason } from '@gymtime/shared';
import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import type { Decision } from '../../attendance/domain/decision.js';
import type { RelevantOccurrence } from '../../schedules/instances.service.js';

/** How far from the server clock an event instant may be (R11). */
export interface TsLimits {
  /** Seconds an event may be ahead of the server clock. */
  futureToleranceSec: number;
  /** Seconds an event may be older than the server clock. */
  maxAgeSec: number;
  /** Nothing earlier than this is credible (a reader that lost its clock). */
  minTs: Date;
}

export interface ReconcileFacts {
  kind: 'entry' | 'exit';
  /** When it happened, by the reader clock. */
  ts: Date;
  /** Server clock: used only to validate `ts`, never to decide (R11). */
  now: Date;
  limits: TsLimits;
  snapshotKnown: boolean;
  /** The slot has an entry in the roster of the event's snapshot. */
  slotKnown: boolean;
  /** Latest instant of this student's events already applied. */
  lastAppliedTs: Date | null;
  /** `decide()` of the entry rules at `ts` (entries only). */
  decision: Decision | null;
  /** The student's open session (exits only; entries read it in `decision`). */
  openSession: Pick<AttendanceSession, 'id' | 'enteredAt'> | null;
  /**
   * The server already closed the student's session of this occurrence as
   * `no_registrada` (alarm timeout or silenced alarm).
   */
  serverClosedSession: boolean;
}

export type ReconcileOutcome =
  | { kind: 'entry'; occurrence: RelevantOccurrence }
  | { kind: 'exit'; sessionId: string }
  | { kind: 'review'; reason: OfflineReviewReason };

const review = (reason: OfflineReviewReason): ReconcileOutcome => ({
  kind: 'review',
  reason,
});

/** Why `ts` cannot be believed, or null when it is inside the limits. */
export function checkTs(
  ts: Date,
  now: Date,
  limits: TsLimits,
): 'TS_FUTURE' | 'TS_TOO_OLD' | null {
  const ahead = (ts.getTime() - now.getTime()) / 1000;
  if (ahead > limits.futureToleranceSec) return 'TS_FUTURE';
  if (-ahead > limits.maxAgeSec || ts < limits.minTs) return 'TS_TOO_OLD';
  return null;
}

/**
 * Pure decision for one event, given the facts the service collected. The
 * order of the checks is the contract (design section 4): the instant limits
 * first, then who it is, then the order, then the same rules as online.
 */
export function reconcile(facts: ReconcileFacts): ReconcileOutcome {
  const badTs = checkTs(facts.ts, facts.now, facts.limits);
  if (badTs) return review(badTs);
  if (!facts.snapshotKnown) return review('UNKNOWN_SNAPSHOT');
  if (!facts.slotKnown) return review('UNKNOWN_SLOT');
  // An event older than one already applied would rewrite history.
  if (facts.lastAppliedTs && facts.ts < facts.lastAppliedTs) {
    return review('OUT_OF_ORDER');
  }
  return facts.kind === 'entry' ? reconcileEntry(facts) : reconcileExit(facts);
}

function reconcileEntry(facts: ReconcileFacts): ReconcileOutcome {
  const decision = facts.decision;
  if (!decision) return review('UNKNOWN_SLOT');
  if (decision.kind === 'exit') return review('DUPLICATE_ENTRY');
  if (decision.kind === 'denied')
    return review(DENIED_TO_REVIEW[decision.reason]);
  if (facts.serverClosedSession) return review('DUPLICATE_ENTRY');
  return { kind: 'entry', occurrence: decision.occurrence };
}

function reconcileExit(facts: ReconcileFacts): ReconcileOutcome {
  const open = facts.openSession;
  if (open) {
    // The exit is never revalidated against the window (it is always allowed
    // online), but it cannot precede the entry it closes.
    return open.enteredAt <= facts.ts
      ? { kind: 'exit', sessionId: open.id }
      : review('OUT_OF_ORDER');
  }
  return review(
    facts.serverClosedSession ? 'SESSION_ALREADY_CLOSED' : 'EXIT_WITHOUT_ENTRY',
  );
}

const DENIED_TO_REVIEW: Record<
  Extract<Decision, { kind: 'denied' }>['reason'],
  OfflineReviewReason
> = {
  UNKNOWN_SLOT: 'UNKNOWN_SLOT',
  NO_ACTIVE_SCHEDULE: 'OUTSIDE_WINDOW',
  NOT_IN_SCHEDULE: 'NOT_IN_SCHEDULE',
  OUTSIDE_ENTRY_WINDOW: 'OUTSIDE_WINDOW',
  ALREADY_EXITED: 'ALREADY_EXITED',
  STUDENT_INACTIVE: 'STUDENT_INACTIVE',
};

/** Events of one batch in the order they must be applied: `ts`, then `seq`. */
export function sortEvents<T extends { ts: Date; seq: number; id: string }>(
  events: readonly T[],
): T[] {
  return [...events].sort(
    (a, b) =>
      a.ts.getTime() - b.ts.getTime() ||
      a.seq - b.seq ||
      a.id.localeCompare(b.id),
  );
}
