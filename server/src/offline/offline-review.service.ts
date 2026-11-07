import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OfflineReviewReason } from '@gymtime/shared';
import { AlarmService } from '../alarm/alarm.service.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { currentActor } from '../common/audit/actor.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { toBogotaParts } from '../common/time/bogota.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { InstancesService } from '../schedules/instances.service.js';
import type { Student } from '../students/domain/student.js';
import { StudentsService } from '../students/students.service.js';
import type {
  OfflineEventFilter,
  OfflineEventRecord,
  OfflineResolution,
} from './domain/offline-event.js';
import {
  OFFLINE_EVENTS_REPOSITORY,
  type OfflineEventsRepository,
} from './domain/offline-events.repository.js';
import {
  allowedActions,
  canApprove,
  canCorrect,
} from './domain/review-rules.js';
import { OfflineReconciler } from './offline-reconciler.js';

export interface ReviewItem {
  record: OfflineEventRecord;
  student: { id: string; name: string; document: string } | null;
  schedule: { id: string; name: string; startsAt: Date } | null;
  actions: OfflineResolution[];
}

export interface ResolveInput {
  action: OfflineResolution;
  /** Mandatory text of the person: why they decided so. */
  reason: string;
  /** New instant for `corregir`. */
  ts?: Date;
}

/**
 * The panel's "Por revisar" (E26-8): lists the events the engine could not
 * apply and resolves each with `aprobar`, `corregir` or `descartar`. The
 * actor comes from the request context (audit trail, like manual
 * registrations). Resolution takes the student's lock and claims the row with
 * a conditional update, so two reviewers can never apply the same event twice.
 */
@Injectable()
export class OfflineReviewService {
  private readonly logger = new Logger(OfflineReviewService.name);

  constructor(
    @Inject(OFFLINE_EVENTS_REPOSITORY)
    private readonly events: OfflineEventsRepository,
    private readonly reconciler: OfflineReconciler,
    private readonly attendance: AttendanceService,
    private readonly alarm: AlarmService,
    private readonly students: StudentsService,
    private readonly instances: InstancesService,
    private readonly eventLog: EventLogService,
    private readonly systemEvents: SystemEventsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(
    filter: OfflineEventFilter,
  ): Promise<{ items: ReviewItem[]; total: number }> {
    const { items, total } = await this.events.list(filter);
    return { items: await this.compose(items), total };
  }

  async count(): Promise<number> {
    return (await this.events.list({ outcomes: ['por_revisar'], limit: 1 }))
      .total;
  }

  /** Events by outcome in a window, for the quality report. */
  async outcomeCounts(window: {
    from: Date;
    to: Date;
  }): Promise<{ reconciled: number; pending: number; discarded: number }> {
    const c = await this.events.countByOutcome(window);
    return {
      reconciled: (c.applied ?? 0) + (c.aprobado ?? 0) + (c.corregido ?? 0),
      pending: c.por_revisar ?? 0,
      discarded: c.descartado ?? 0,
    };
  }

  async resolve(id: string, input: ResolveInput): Promise<ReviewItem> {
    const record = await this.find(id);
    if (record.outcome !== 'por_revisar' || !record.reviewReason) {
      throw alreadyResolved();
    }
    const resolved = record.studentId
      ? await this.attendance.runExclusive(record.studentId, () =>
          this.resolveLocked(id, input),
        )
      : await this.resolveLocked(id, input);
    await this.afterResolution(resolved, input);
    const [item] = await this.compose([resolved]);
    return item!;
  }

  private async find(id: string): Promise<OfflineEventRecord> {
    const { items } = await this.events.list({ id, limit: 1 });
    const record = items[0];
    if (!record) {
      throw new NotFoundException({
        code: 'EVENT_NOT_FOUND',
        message: 'El evento no existe',
      });
    }
    return record;
  }

  /** Re-reads the event inside the lock: another reviewer may have won. */
  private async resolveLocked(
    id: string,
    input: ResolveInput,
  ): Promise<OfflineEventRecord> {
    const record = await this.find(id);
    const reason = record.reviewReason;
    if (record.outcome !== 'por_revisar' || !reason) throw alreadyResolved();
    const base = {
      resolvedBy: actorUserId(),
      resolvedAt: this.clock.now(),
      resolutionNote: input.reason,
      resolution: input.action,
    };
    let saved: OfflineEventRecord | null;
    if (input.action === 'descartar') {
      saved = await this.events.resolve(record.deviceId, id, {
        ...base,
        outcome: 'descartado',
      });
    } else if (input.action === 'aprobar') {
      saved = await this.approve(record, reason, base);
    } else {
      saved = await this.correct(record, reason, input.ts, base);
    }
    if (!saved) throw alreadyResolved();
    return saved;
  }

  private async approve(
    record: OfflineEventRecord,
    reason: OfflineReviewReason,
    base: ResolutionBase,
  ): Promise<OfflineEventRecord | null> {
    if (!canApprove(record.type, reason)) {
      throw new ConflictException({
        code: 'NOT_APPROVABLE',
        message:
          'Este motivo no se puede aprobar; descártelo o corrija la hora',
      });
    }
    const student = await this.studentOf(record);
    const session = await this.applyApproved(record, student);
    return this.events.resolve(record.deviceId, record.id, {
      ...base,
      outcome: 'aprobado',
      sessionId: session.id,
      instanceId: session.instanceId,
    });
  }

  /** Applies the event at its own instant, skipping only the check that failed. */
  private async applyApproved(record: OfflineEventRecord, student: Student) {
    const ts = record.ts;
    if (record.type === 'entry') {
      if (await this.attendance.findOpenSession(student.id)) {
        throw conflict('SESSION_ALREADY_OPEN', 'El estudiante ya está dentro');
      }
      const occurrence = await this.attendance.occurrenceOnDay(student.id, ts);
      if (!occurrence) {
        throw conflict(
          'NO_OCCURRENCE',
          'El estudiante no tenía un horario ese día; descarte el evento',
        );
      }
      return this.attendance.applyOfflineEntry(student, occurrence, ts);
    }
    const open = await this.attendance.findOpenSession(student.id);
    if (open) {
      if (open.enteredAt > ts) {
        throw conflict(
          'INCONSISTENT_TIME',
          'La salida es anterior a la entrada abierta; corrija la hora',
        );
      }
      const closed = await this.attendance.applyOfflineExit(
        student,
        open.id,
        ts,
      );
      if (closed) return closed;
    }
    const reopened = await this.attendance.reopenUnregisteredWithExit(
      student,
      ts,
    );
    if (!reopened) {
      throw conflict(
        'NO_OPEN_SESSION',
        'El estudiante no tiene sesión que cerrar',
      );
    }
    return reopened;
  }

  private async correct(
    record: OfflineEventRecord,
    reason: OfflineReviewReason,
    ts: Date | undefined,
    base: ResolutionBase,
  ): Promise<OfflineEventRecord | null> {
    if (!canCorrect(record.type, reason)) {
      throw new ConflictException({
        code: 'NOT_CORRECTABLE',
        message: 'Este evento no se puede corregir; descártelo',
      });
    }
    if (!ts) {
      throw new BadRequestException({
        code: 'TS_REQUIRED',
        message: 'Indique la hora corregida',
      });
    }
    this.checkCorrectedTs(record, ts);
    const student = await this.studentOf(record);
    const outcome = await this.reconciler.evaluate(
      {
        kind: record.type as 'entry' | 'exit',
        ts,
        student,
        snapshotKnown: true,
        slotKnown: true,
      },
      { trustTs: true },
    );
    if (outcome.kind === 'review') {
      throw new UnprocessableEntityException({
        code: 'STILL_CONFLICT',
        reason: outcome.reason,
        message: 'Con esa hora el evento sigue en conflicto',
      });
    }
    const session =
      outcome.kind === 'entry'
        ? await this.attendance.applyOfflineEntry(
            student,
            outcome.occurrence,
            ts,
          )
        : await this.attendance.applyOfflineExit(
            student,
            outcome.sessionId,
            ts,
          );
    if (!session) throw alreadyResolved();
    return this.events.resolve(record.deviceId, record.id, {
      ...base,
      outcome: 'corregido',
      correctedTs: ts,
      sessionId: session.id,
      instanceId: session.instanceId,
    });
  }

  /** Same Bogota day as the event, and not in the future. */
  private checkCorrectedTs(record: OfflineEventRecord, ts: Date): void {
    const sameDay = toBogotaParts(ts).date === toBogotaParts(record.ts).date;
    if (!sameDay || ts > this.clock.now()) {
      throw new BadRequestException({
        code: 'INVALID_CORRECTION',
        message:
          'La hora corregida debe ser del mismo día del evento y no estar en el futuro',
      });
    }
  }

  private async studentOf(record: OfflineEventRecord): Promise<Student> {
    const student = record.studentId
      ? await this.students.findById(record.studentId)
      : null;
    if (!student) {
      throw conflict('STUDENT_NOT_FOUND', 'El estudiante ya no existe');
    }
    return student;
  }

  /** Audit, live counter and the late alarm of the occurrence. */
  private async afterResolution(
    resolved: OfflineEventRecord,
    input: ResolveInput,
  ): Promise<void> {
    await this.eventLog.record('offline.review.resolved', {
      eventId: resolved.id,
      deviceId: resolved.deviceId,
      action: input.action,
      reviewReason: resolved.reviewReason,
      note: input.reason,
      sessionId: resolved.sessionId,
    });
    this.logger.log({
      event: 'offline_review_resolved',
      eventId: resolved.id,
      action: input.action,
    });
    if (resolved.instanceId && resolved.type === 'entry') {
      try {
        await this.alarm.onLateOpenSessions(resolved.instanceId);
      } catch (error) {
        this.logger.error({
          event: 'offline_late_alarm_failed',
          instanceId: resolved.instanceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.systemEvents.emit('offline.review', { pending: await this.count() });
  }

  private async compose(records: OfflineEventRecord[]): Promise<ReviewItem[]> {
    const studentIds = [
      ...new Set(records.flatMap((r) => (r.studentId ? [r.studentId] : []))),
    ];
    const instanceIds = [
      ...new Set(records.flatMap((r) => (r.instanceId ? [r.instanceId] : []))),
    ];
    const [students, occurrences] = await Promise.all([
      studentIds.length ? this.students.findByIds(studentIds) : [],
      this.instances.getByIds(instanceIds),
    ]);
    const byStudent = new Map(students.map((s) => [s.id, s]));
    return records.map((record) => {
      const student = record.studentId
        ? byStudent.get(record.studentId)
        : undefined;
      const occurrence = record.instanceId
        ? occurrences.get(record.instanceId)
        : undefined;
      return {
        record,
        student: student
          ? { id: student.id, name: student.name, document: student.document }
          : null,
        schedule: occurrence
          ? {
              id: occurrence.schedule.id,
              name: occurrence.schedule.name,
              startsAt: occurrence.instance.startsAt,
            }
          : null,
        actions:
          record.outcome === 'por_revisar'
            ? allowedActions(record.type, record.reviewReason)
            : [],
      };
    });
  }
}

interface ResolutionBase {
  resolvedBy: string | null;
  resolvedAt: Date;
  resolutionNote: string;
  resolution: OfflineResolution;
}

function actorUserId(): string | null {
  const actor = currentActor();
  return actor.type === 'user' ? actor.id : null;
}

const alreadyResolved = () =>
  new ConflictException({
    code: 'ALREADY_RESOLVED',
    message: 'Otra persona ya resolvió este evento',
  });

const conflict = (code: string, message: string) =>
  new ConflictException({ code, message });
