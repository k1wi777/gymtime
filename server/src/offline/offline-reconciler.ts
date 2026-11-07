import { Inject, Injectable } from '@nestjs/common';
import { AttendanceService } from '../attendance/attendance.service.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import type { Student } from '../students/domain/student.js';
import {
  OFFLINE_EVENTS_REPOSITORY,
  type OfflineEventsRepository,
} from './domain/offline-events.repository.js';
import {
  reconcile,
  type ReconcileOutcome,
  type TsLimits,
} from './domain/reconcile.js';
import { OFFLINE_CONFIG, type OfflineConfig } from './offline.config.js';

const UNLIMITED: TsLimits = {
  futureToleranceSec: Infinity,
  maxAgeSec: Infinity,
  minTs: new Date(0),
};

export interface MovementToEvaluate {
  kind: 'entry' | 'exit';
  ts: Date;
  /** Null when the slot or the snapshot could not be resolved. */
  student: Student | null;
  snapshotKnown: boolean;
  slotKnown: boolean;
}

/**
 * Collects the facts the pure engine needs and asks it. The student's lock
 * must be held by the caller, so the facts stay true until the outcome is
 * applied. Shared by the batch handler and the "corregir hora" action.
 */
@Injectable()
export class OfflineReconciler {
  constructor(
    private readonly attendance: AttendanceService,
    @Inject(OFFLINE_EVENTS_REPOSITORY)
    private readonly events: OfflineEventsRepository,
    @Inject(OFFLINE_CONFIG) private readonly config: OfflineConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * `trustTs` skips the limits on the instant: a person who corrects the hour
   * vouches for it (the correction is still limited to the same day and to
   * the past by the review service).
   */
  async evaluate(
    movement: MovementToEvaluate,
    options: { trustTs?: boolean } = {},
  ): Promise<ReconcileOutcome> {
    const { student } = movement;
    const resolvable = student !== null && movement.snapshotKnown;
    const [lastAppliedTs, facts] = resolvable
      ? await Promise.all([
          this.events.lastAppliedTs(student.id),
          this.attendance.offlineFacts(student, movement.kind, movement.ts),
        ])
      : [
          null,
          { decision: null, openSession: null, serverClosedSession: false },
        ];
    return reconcile({
      kind: movement.kind,
      ts: movement.ts,
      // The server clock only validates `ts`; it never decides (R11).
      now: this.clock.now(),
      limits: options.trustTs ? UNLIMITED : this.config.limits,
      snapshotKnown: movement.snapshotKnown,
      slotKnown: movement.slotKnown && student !== null,
      lastAppliedTs,
      decision: facts.decision,
      openSession: facts.openSession,
      serverClosedSession: facts.serverClosedSession,
    });
  }
}
