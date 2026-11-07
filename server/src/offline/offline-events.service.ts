import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  offlineEventSchema,
  type OfflineEvent,
  type OfflineReviewReason,
} from '@gymtime/shared';
import { AlarmService } from '../alarm/alarm.service.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { KeyedMutex } from '../common/concurrency/keyed-mutex.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { toBogotaParts } from '../common/time/bogota.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { InstancesService } from '../schedules/instances.service.js';
import { StudentsService } from '../students/students.service.js';
import type {
  OfflineEventRecord,
  OfflineSettlement,
} from './domain/offline-event.js';
import {
  OFFLINE_EVENTS_REPOSITORY,
  type OfflineEventsRepository,
} from './domain/offline-events.repository.js';
import {
  OFFLINE_SNAPSHOTS_REPOSITORY,
  type OfflineSnapshotRecord,
  type OfflineSnapshotsRepository,
} from './domain/offline-snapshots.repository.js';
import { sortEvents } from './domain/reconcile.js';
import { OfflineReconciler } from './offline-reconciler.js';

/** What the handler needs of an `offline.events` message. */
export interface OfflineBatch {
  messageId: string;
  batch: number;
  last: boolean;
  events: unknown[];
}

export interface BatchSummary {
  received: number;
  applied: number;
  review: number;
  informative: number;
  alarms: number;
  duplicates: number;
  invalid: number;
}

/**
 * Receives the queue a reader kept while it was offline and reconciles it
 * with the instant of each event (E26-4, E26-5). Nothing is lost and nothing
 * is accepted silently: every event ends `applied`, `por_revisar`,
 * `informativo` or counted as invalid in the audit trail, and only then does
 * the caller send the `ack`.
 */
@Injectable()
export class OfflineEventsService {
  private readonly logger = new Logger(OfflineEventsService.name);
  private readonly mutex = new KeyedMutex();

  constructor(
    @Inject(OFFLINE_EVENTS_REPOSITORY)
    private readonly events: OfflineEventsRepository,
    @Inject(OFFLINE_SNAPSHOTS_REPOSITORY)
    private readonly snapshots: OfflineSnapshotsRepository,
    private readonly reconciler: OfflineReconciler,
    private readonly attendance: AttendanceService,
    private readonly alarm: AlarmService,
    private readonly instances: InstancesService,
    private readonly students: StudentsService,
    private readonly eventLog: EventLogService,
    private readonly systemEvents: SystemEventsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** One batch per device at a time, so concurrent retries cannot interleave. */
  handleBatch(deviceId: string, batch: OfflineBatch): Promise<BatchSummary> {
    return this.mutex.run(deviceId, () => this.process(deviceId, batch));
  }

  private async process(
    deviceId: string,
    batch: OfflineBatch,
  ): Promise<BatchSummary> {
    const summary: BatchSummary = {
      received: batch.events.length,
      applied: 0,
      review: 0,
      informative: 0,
      alarms: 0,
      duplicates: 0,
      invalid: 0,
    };
    const { valid, invalid } = this.validate(batch.events);
    summary.invalid = invalid.length;
    const unique = dedupe(valid);
    summary.duplicates += valid.length - unique.length;

    const stored = await this.events.insertIfAbsent(
      unique.map((event) => ({
        deviceId,
        id: event.id,
        seq: event.seq,
        ts: new Date(event.ts * 1000),
        type: event.type,
        slot: 'slot' in event ? event.slot : null,
        snapshotId: event.snapshotId,
        batchId: batch.messageId,
        receivedAt: this.clock.now(),
      })),
    );
    const byId = new Map(unique.map((event) => [event.id, event]));
    // A decided event is a repeat; a `pendiente` one was cut by a crash.
    const todo = stored.filter(({ record }) => record.outcome === 'pendiente');
    summary.duplicates += stored.length - todo.length;

    const cache = new SnapshotCache(this.snapshots, deviceId);
    const touched = new Set<string>();
    for (const record of sortEvents(todo.map((t) => t.record))) {
      const event = byId.get(record.id);
      if (!event) continue;
      const settlement = await this.decide(record, event, cache);
      if (settlement.instanceId) touched.add(settlement.instanceId);
      this.count(summary, settlement, event);
    }

    await this.closeLateInstances(touched);
    await this.audit(deviceId, batch, summary, invalid);
    if (summary.review > 0) await this.publishPending();
    return summary;
  }

  private validate(raw: unknown[]): {
    valid: OfflineEvent[];
    invalid: { index: number; fields: string[] }[];
  } {
    const valid: OfflineEvent[] = [];
    const invalid: { index: number; fields: string[] }[] = [];
    raw.forEach((item, index) => {
      const parsed = offlineEventSchema.safeParse(item);
      if (parsed.success) {
        valid.push(parsed.data);
        return;
      }
      // Only field names: the content of a rejected event is never kept.
      const fields = [
        ...new Set(
          parsed.error.issues.map((i) => i.path.join('.') || '(root)'),
        ),
      ];
      invalid.push({ index, fields });
    });
    return { valid, invalid };
  }

  /** Decides one event, saves its outcome and returns what was saved. */
  private async decide(
    record: OfflineEventRecord,
    event: OfflineEvent,
    cache: SnapshotCache,
  ): Promise<OfflineSettlement> {
    let settlement: OfflineSettlement;
    if (event.type === 'unknown') {
      settlement = { outcome: 'informativo' };
    } else if (event.type === 'alarm') {
      settlement = await this.applyAlarm(record, event, cache);
    } else {
      settlement = await this.applyMovement(record, event, cache);
    }
    await this.events.settle(record.deviceId, record.id, settlement);
    return settlement;
  }

  private async applyMovement(
    record: OfflineEventRecord,
    event: Extract<OfflineEvent, { type: 'entry' | 'exit' }>,
    cache: SnapshotCache,
  ): Promise<OfflineSettlement> {
    const snapshot = await cache.get(event.snapshotId);
    const studentId = snapshot?.roster[event.slot] ?? null;
    const student = studentId ? await this.students.findById(studentId) : null;
    const ts = record.ts;
    const run = async (): Promise<OfflineSettlement> => {
      const known = { studentId: student?.id ?? null };
      // A crash may have saved the session but not the outcome: link it.
      const existing = student
        ? await this.attendance.findOfflineEffect(student.id, event.type, ts)
        : null;
      if (student && existing) {
        return {
          outcome: 'applied',
          ...known,
          instanceId: existing.instanceId,
          sessionId: existing.id,
        };
      }
      const outcome = await this.reconciler.evaluate({
        kind: event.type,
        ts,
        student,
        snapshotKnown: snapshot !== null,
        slotKnown: studentId !== null,
      });
      if (outcome.kind === 'review') {
        return reviewOf(outcome.reason, known.studentId);
      }
      if (!student) throw new Error('reconciled an event without a student');
      if (outcome.kind === 'entry') {
        const session = await this.attendance.applyOfflineEntry(
          student,
          outcome.occurrence,
          ts,
        );
        return {
          outcome: 'applied',
          ...known,
          instanceId: session.instanceId,
          sessionId: session.id,
        };
      }
      const closed = await this.attendance.applyOfflineExit(
        student,
        outcome.sessionId,
        ts,
      );
      // Someone closed it between the facts and now: let a person look.
      if (!closed) return reviewOf('OUT_OF_ORDER', known.studentId);
      return {
        outcome: 'applied',
        ...known,
        instanceId: closed.instanceId,
        sessionId: closed.id,
      };
    };
    return student ? this.attendance.runExclusive(student.id, run) : run();
  }

  private async applyAlarm(
    record: OfflineEventRecord,
    event: Extract<OfflineEvent, { type: 'alarm' }>,
    cache: SnapshotCache,
  ): Promise<OfflineSettlement> {
    const snapshot = await cache.get(event.snapshotId);
    const instance = snapshot?.scheduleId
      ? await this.instances.findOnDate(
          snapshot.scheduleId,
          toBogotaParts(record.ts).date,
        )
      : null;
    if (!instance) {
      // Nothing to attach the alarm to; the event row stays as the trace.
      this.logger.warn({
        event: 'offline_alarm_unplaced',
        deviceId: record.deviceId,
        eventId: record.id,
      });
      return { outcome: 'informativo' };
    }
    const { event: stored } = await this.alarm.recordLocalAlarm({
      instanceId: instance.id,
      deviceId: record.deviceId,
      deviceEventId: record.id,
      startedAt: record.ts,
      endedAt: event.endTs === null ? null : new Date(event.endTs * 1000),
      endedBy: event.endedBy,
    });
    return {
      outcome: 'applied',
      instanceId: instance.id,
      alarmEventId: stored.id,
    };
  }

  private count(
    summary: BatchSummary,
    settlement: OfflineSettlement,
    event: OfflineEvent,
  ): void {
    if (settlement.outcome === 'por_revisar') summary.review++;
    else if (settlement.outcome === 'informativo') summary.informative++;
    else if (event.type === 'alarm') summary.alarms++;
    else summary.applied++;
  }

  /**
   * Occurrences that ended while the reader was cut off and were left with
   * open sessions: the usual alarm, or the automatic close (R13).
   */
  private async closeLateInstances(instanceIds: Set<string>): Promise<void> {
    for (const instanceId of instanceIds) {
      try {
        await this.alarm.onLateOpenSessions(instanceId);
      } catch (error) {
        this.logger.error({
          event: 'offline_late_alarm_failed',
          instanceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private audit(
    deviceId: string,
    batch: OfflineBatch,
    summary: BatchSummary,
    invalid: { index: number; fields: string[] }[],
  ): Promise<void> {
    this.logger.log({
      event: 'offline_batch',
      deviceId,
      batchId: batch.messageId,
      ...summary,
    });
    // Counters, indexes and field names only: never names, documents or the
    // raw content of an event (R19).
    return this.eventLog.record('offline.batch', {
      deviceId,
      batchId: batch.messageId,
      batch: batch.batch,
      last: batch.last,
      ...summary,
      invalidEvents: invalid,
    });
  }

  private async publishPending(): Promise<void> {
    const { total } = await this.events.list({
      outcomes: ['por_revisar'],
      limit: 1,
    });
    this.systemEvents.emit('offline.review', { pending: total });
  }
}

const reviewOf = (
  reason: OfflineReviewReason,
  studentId: string | null,
): OfflineSettlement => ({
  outcome: 'por_revisar',
  reviewReason: reason,
  studentId,
});

function dedupe(events: OfflineEvent[]): OfflineEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

/** Snapshots read once per batch. */
class SnapshotCache {
  private readonly found = new Map<string, OfflineSnapshotRecord | null>();

  constructor(
    private readonly repository: OfflineSnapshotsRepository,
    private readonly deviceId: string,
  ) {}

  async get(id: string): Promise<OfflineSnapshotRecord | null> {
    if (!this.found.has(id)) {
      this.found.set(id, await this.repository.find(this.deviceId, id));
    }
    return this.found.get(id) ?? null;
  }
}
