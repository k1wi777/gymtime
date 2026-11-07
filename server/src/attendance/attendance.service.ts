import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventLogService } from '../common/audit/event-log.service.js';
import { KeyedMutex } from '../common/concurrency/keyed-mutex.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { toBogotaParts } from '../common/time/bogota.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import {
  InstancesService,
  type Occurrence,
  type RelevantOccurrence,
} from '../schedules/instances.service.js';
import type { Student } from '../students/domain/student.js';
import { StudentsService } from '../students/students.service.js';
import { SyncService } from '../sync/sync.service.js';
import {
  ATTENDANCE_REPOSITORY,
  type AttendanceFilter,
  type AttendanceRepository,
} from './domain/attendance.repository.js';
import type {
  AttendanceSession,
  AttendanceSource,
  SessionStatus,
} from './domain/attendance-session.js';
import { AttendanceError } from './domain/attendance.errors.js';
import { ALARM_PORT, type AlarmPort } from './domain/alarm.port.js';
import { decide, type Decision } from './domain/decision.js';

/** What the device handler needs to build the `scan.result`. */
export interface ScanOutcome {
  student: Student | null;
  decision: Decision;
  /** Server instant of the decision (R2). */
  at: Date;
}

export interface SessionStudentView {
  id: string;
  document: string;
  name: string;
}

export interface SessionInstanceView {
  id: string;
  scheduleId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface OpenSessionView {
  id: string;
  student: SessionStudentView;
  enteredAt: Date;
  instance: SessionInstanceView;
}

export interface SessionView extends OpenSessionView {
  exitedAt: Date | null;
  entrySource: AttendanceSource;
  exitSource: AttendanceSource | null;
  status: SessionStatus;
  manualReason: string | null;
}

/**
 * Attendance core: decides entry/exit from a scan, records sessions, manual
 * registrations and the read models used by the REST API and the sync.
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);
  private readonly mutex = new KeyedMutex();

  constructor(
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly sessions: AttendanceRepository,
    private readonly sync: SyncService,
    private readonly instances: InstancesService,
    private readonly students: StudentsService,
    @Inject(ALARM_PORT) private alarm: AlarmPort,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly eventLog: EventLogService,
    private readonly events: SystemEventsService,
  ) {}

  /** The alarm module replaces the initial no-op once it is wired. */
  setAlarmPort(port: AlarmPort): void {
    this.alarm = port;
  }

  /** Resolves the slot, decides and, when accepted, persists the session. */
  async recordScan(
    deviceId: string,
    slot: number,
    deviceTs: number,
  ): Promise<ScanOutcome> {
    const at = this.clock.now();
    const student = await this.sync.findStudentBySlot(deviceId, slot);
    if (!student) {
      const decision: Decision = { kind: 'denied', reason: 'UNKNOWN_SLOT' };
      this.logDecision(deviceId, slot, deviceTs, at, null, decision);
      return { student: null, decision, at };
    }
    return this.mutex.run(student.id, async () => {
      const decision = await this.decide(student, at);
      await this.persist(decision, student, at, 'device', null);
      this.logDecision(deviceId, slot, deviceTs, at, student, decision);
      return { student, decision, at };
    });
  }

  /** Records an unrecognised fingerprint; returns the server instant. */
  recordUnknown(deviceId: string): Date {
    const at = this.clock.now();
    this.logger.log({
      event: 'fingerprint_unknown',
      deviceId,
      at: at.toISOString(),
    });
    return at;
  }

  /**
   * `button.pressed` is recorded and delegated to the alarm, which silences a
   * running siren. A failing port is logged and never breaks the ack.
   */
  async recordButton(deviceId: string): Promise<void> {
    this.logger.log({ event: 'button_pressed', deviceId });
    try {
      await this.alarm.onButtonPressed(deviceId);
    } catch (error) {
      this.logger.error({
        event: 'alarm_button_failed',
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Manual entry with a mandatory reason (R13). */
  registerManualEntry(
    studentId: string,
    reason: string,
  ): Promise<AttendanceSession> {
    return this.withStudent(studentId, async (student) => {
      const open = await this.sessions.findOpenByStudent(student.id);
      if (open) throw new AttendanceError('SESSION_ALREADY_OPEN');
      const at = this.clock.now();
      const decision = await this.decide(student, at);
      if (decision.kind !== 'entry') {
        throw new AttendanceError(
          decision.kind === 'denied' ? decision.reason : 'SESSION_ALREADY_OPEN',
        );
      }
      const session = await this.openSession(
        student,
        decision.occurrence.instance.id,
        at,
        'manual',
        reason,
      );
      await this.recordManual('entry', session);
      return session;
    });
  }

  /** Manual exit: the window is not rechecked, an exit is always allowed (R3). */
  registerManualExit(
    studentId: string,
    reason: string,
  ): Promise<AttendanceSession> {
    return this.withStudent(studentId, async (student) => {
      const open = await this.sessions.findOpenByStudent(student.id);
      if (!open) throw new AttendanceError('NO_OPEN_SESSION');
      const closed = await this.sessions.close(open.id, {
        exitedAt: this.clock.now(),
        exitSource: 'manual',
        manualReason: reason,
      });
      if (!closed) throw new AttendanceError('NO_OPEN_SESSION');
      await this.recordManual('exit', closed);
      this.publish('exit', 'manual', student, closed);
      await this.notifyAlarmIfEmpty(closed.instanceId);
      return closed;
    });
  }

  /** Tells the live panels that a session changed (after it was saved). */
  private publish(
    change: 'entry' | 'exit',
    source: AttendanceSource,
    student: Student,
    session: AttendanceSession,
  ): void {
    this.events.emit('attendance', {
      change,
      source,
      studentId: student.id,
      studentName: student.name,
      instanceId: session.instanceId,
      sessionId: session.id,
    });
  }

  /** Audit trail of the manual registrations (who did it comes from the context). */
  private recordManual(
    kind: 'entry' | 'exit',
    session: AttendanceSession,
  ): Promise<void> {
    return this.eventLog.record('attendance.manual', {
      kind,
      sessionId: session.id,
      studentId: session.studentId,
      instanceId: session.instanceId,
    });
  }

  /** Students who are inside right now (R15). */
  async listOpen(): Promise<OpenSessionView[]> {
    const sessions = await this.sessions.list({ status: 'abierta' });
    const composed = await this.compose(sessions);
    return composed.map((session) => ({
      id: session.id,
      student: session.student,
      enteredAt: session.enteredAt,
      instance: session.instance,
    }));
  }

  /** Sessions with filters, for the REST listing (R15). */
  listSessions(filter: AttendanceFilter = {}): Promise<SessionView[]> {
    return this.sessions.list(filter).then((rows) => this.compose(rows));
  }

  /**
   * Raw sessions of these occurrences (optionally of some students) for the
   * reports: no student or occurrence is composed, only the rows.
   */
  listForReport(
    instanceIds: string[],
    studentIds?: string[],
  ): Promise<AttendanceSession[]> {
    if (instanceIds.length === 0 || studentIds?.length === 0) {
      return Promise.resolve([]);
    }
    return this.sessions.list({ instanceIds, studentIds });
  }

  /** How many sessions match the filter, ignoring pagination. */
  countSessions(filter: AttendanceFilter): Promise<number> {
    return this.sessions.count(filter);
  }

  /** Occurrences, among these, that have sessions (history that must be kept). */
  async instanceIdsWithSessions(instanceIds: string[]): Promise<string[]> {
    if (instanceIds.length === 0) return [];
    const rows = await this.sessions.list({ instanceIds });
    return [...new Set(rows.map((row) => row.instanceId))];
  }

  /** One page of the history, newest first, with the total (E22-1). */
  async pageSessions(
    filter: AttendanceFilter,
  ): Promise<{ items: SessionView[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.sessions.list({ ...filter, order: 'desc' }),
      this.sessions.count(filter),
    ]);
    return { items: await this.compose(rows), total };
  }

  /** Student ids with an open session, for the sync's open-sessions provider (R17). */
  listOpenStudentIds(): Promise<string[]> {
    return this.sessions.listOpenStudentIds();
  }

  /** Open sessions of one occurrence, used by the alarm at its end (E8-1). */
  countOpenByInstance(instanceId: string): Promise<number> {
    return this.sessions.countOpenByInstance(instanceId);
  }

  /**
   * Closes every open session of an occurrence as `no_registrada` with the
   * given reason (`alarm_off_button`, `alarm_off_cli`, `timeout`). Used by the
   * alarm when it is silenced manually or by the timeout; it does not notify
   * the port, because the alarm itself orchestrates the `CLEARED`.
   */
  markUnregisteredByInstance(
    instanceId: string,
    reason: string,
  ): Promise<number> {
    return this.sessions.closeOpenByInstance(instanceId, {
      manualReason: reason,
    });
  }

  private async withStudent<T>(
    studentId: string,
    action: (student: Student) => Promise<T>,
  ): Promise<T> {
    const student = await this.students.findById(studentId);
    if (!student) throw new AttendanceError('STUDENT_NOT_FOUND');
    return this.mutex.run(student.id, () => action(student));
  }

  /**
   * Runs `action` holding the student's lock, the one scans and manual
   * registrations use, so a reconciliation never interleaves with them.
   */
  runExclusive<T>(studentId: string, action: () => Promise<T>): Promise<T> {
    return this.mutex.run(studentId, action);
  }

  /**
   * What the rules say about an offline event at its own instant `ts`: the
   * same `decide()` as online with `at = ts`, the open session, and whether
   * the server already closed the student's session of that occurrence as
   * `no_registrada`. The caller holds the student's lock.
   */
  async offlineFacts(
    student: Student,
    kind: 'entry' | 'exit',
    ts: Date,
  ): Promise<{
    decision: Decision | null;
    openSession: AttendanceSession | null;
    serverClosedSession: boolean;
  }> {
    if (kind === 'entry') {
      const decision = await this.decide(student, ts);
      const unregistered = await this.unregisteredBefore(student.id, ts);
      const target =
        decision.kind === 'entry' ? decision.occurrence.instance.id : null;
      return {
        decision,
        openSession: null,
        serverClosedSession: unregistered.some((s) => s.instanceId === target),
      };
    }
    const [openSession, closed] = await Promise.all([
      this.sessions.findOpenByStudent(student.id),
      this.unregisteredOfDay(student.id, ts),
    ]);
    return {
      decision: null,
      openSession,
      serverClosedSession: closed !== null,
    };
  }

  /** Entry with the reader's own instant and `offline` as source (R8). */
  applyOfflineEntry(
    student: Student,
    occurrence: RelevantOccurrence | Occurrence,
    ts: Date,
  ): Promise<AttendanceSession> {
    return this.openSession(student, occurrence.instance.id, ts, 'offline');
  }

  /** Exit with the reader's own instant; null if the session is not open anymore. */
  async applyOfflineExit(
    student: Student,
    sessionId: string,
    ts: Date,
  ): Promise<AttendanceSession | null> {
    const closed = await this.sessions.close(sessionId, {
      exitedAt: ts,
      exitSource: 'offline',
    });
    if (closed) {
      this.publish('exit', 'offline', student, closed);
      await this.notifyAlarmIfEmpty(closed.instanceId);
    }
    return closed;
  }

  /**
   * An exit a person approved over a session the server had closed as
   * `no_registrada`: it becomes `cerrada` with the real exit (R13).
   */
  async reopenUnregisteredWithExit(
    student: Student,
    ts: Date,
  ): Promise<AttendanceSession | null> {
    const unregistered = await this.unregisteredOfDay(student.id, ts);
    if (!unregistered) return null;
    const closed = await this.sessions.closeUnregistered(unregistered.id, {
      exitedAt: ts,
      exitSource: 'offline',
    });
    if (closed) this.publish('exit', 'offline', student, closed);
    return closed;
  }

  /** The student's open session, for the approval of an offline exit. */
  findOpenSession(studentId: string): Promise<AttendanceSession | null> {
    return this.sessions.findOpenByStudent(studentId);
  }

  /** The session an offline event already produced (replay after a crash). */
  findOfflineEffect(
    studentId: string,
    kind: 'entry' | 'exit',
    ts: Date,
  ): Promise<AttendanceSession | null> {
    return this.sessions.findOfflineSession(studentId, kind, ts);
  }

  /** Students who already left this occurrence, for the reader's snapshot. */
  listClosedStudentIdsByInstance(instanceId: string): Promise<string[]> {
    return this.sessions.listClosedStudentIds(instanceId);
  }

  /** Occurrence that best matches `ts` for a student (see InstancesService). */
  occurrenceOnDay(studentId: string, ts: Date): Promise<Occurrence | null> {
    return this.instances.findForStudentOnDay(studentId, ts);
  }

  /** `no_registrada` sessions entered at or before `ts`, newest first. */
  private unregisteredBefore(
    studentId: string,
    ts: Date,
  ): Promise<AttendanceSession[]> {
    return this.sessions.list({
      studentId,
      status: 'no_registrada',
      to: ts,
      order: 'desc',
      limit: 5,
    });
  }

  /** The student's `no_registrada` session of the Bogota day of `ts`, if any. */
  private async unregisteredOfDay(
    studentId: string,
    ts: Date,
  ): Promise<AttendanceSession | null> {
    const candidates = await this.unregisteredBefore(studentId, ts);
    if (candidates.length === 0) return null;
    const occurrences = await this.instances.getByIds(
      candidates.map((s) => s.instanceId),
    );
    const day = toBogotaParts(ts).date;
    return (
      candidates.find(
        (s) => occurrences.get(s.instanceId)?.instance.date === day,
      ) ?? null
    );
  }

  private async openSession(
    student: Student,
    instanceId: string,
    at: Date,
    source: AttendanceSource,
    manualReason: string | null = null,
  ): Promise<AttendanceSession> {
    const created = await this.sessions.create({
      studentId: student.id,
      instanceId,
      enteredAt: at,
      entrySource: source,
      manualReason,
    });
    this.publish('entry', source, student, created);
    return created;
  }

  private async decide(student: Student, at: Date): Promise<Decision> {
    const [activeOccurrences, openSession, closedInstanceIds] =
      await Promise.all([
        this.instances.listActive(at),
        this.sessions.findOpenByStudent(student.id),
        this.sessions.listClosedInstanceIds(student.id),
      ]);
    return decide({
      student,
      at,
      activeOccurrences,
      openSession,
      closedInstanceIds,
    });
  }

  private async persist(
    decision: Decision,
    student: Student,
    at: Date,
    source: AttendanceSource,
    manualReason: string | null,
  ): Promise<void> {
    if (decision.kind === 'entry') {
      await this.openSession(
        student,
        decision.occurrence.instance.id,
        at,
        source,
        manualReason,
      );
      return;
    }
    if (decision.kind === 'exit') {
      const closed = await this.sessions.close(decision.session.id, {
        exitedAt: at,
        exitSource: source,
        manualReason,
      });
      if (closed) {
        this.publish('exit', source, student, closed);
        await this.notifyAlarmIfEmpty(closed.instanceId);
      }
    }
  }

  private async notifyAlarmIfEmpty(instanceId: string): Promise<void> {
    try {
      if ((await this.sessions.countOpenByInstance(instanceId)) > 0) return;
      await this.alarm.onInstanceEmptied(instanceId);
      this.logger.log({ event: 'alarm_notified', instanceId });
    } catch (error) {
      this.logger.error({
        event: 'alarm_notify_failed',
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private logDecision(
    deviceId: string,
    slot: number,
    deviceTs: number,
    at: Date,
    student: Student | null,
    decision: Decision,
  ): void {
    this.logger.log({
      event: 'scan_decided',
      deviceId,
      slot,
      // Reference only: the decision never uses the device clock (R2).
      deviceTs,
      at: at.toISOString(),
      studentId: student?.id ?? null,
      result: decision.kind,
      reason: decision.kind === 'denied' ? decision.reason : null,
    });
  }

  private async compose(sessions: AttendanceSession[]): Promise<SessionView[]> {
    if (sessions.length === 0) return [];
    const students = await this.students.findByIds([
      ...new Set(sessions.map((s) => s.studentId)),
    ]);
    const occurrences = await this.instances.getByIds([
      ...new Set(sessions.map((s) => s.instanceId)),
    ]);
    const byStudent = new Map(students.map((s) => [s.id, s]));
    return sessions.flatMap((session) => {
      const student = byStudent.get(session.studentId);
      const occurrence = occurrences.get(session.instanceId);
      if (!student || !occurrence) return [];
      return [
        {
          id: session.id,
          student: {
            id: student.id,
            document: student.document,
            name: student.name,
          },
          enteredAt: session.enteredAt,
          instance: instanceView(occurrence),
          exitedAt: session.exitedAt,
          entrySource: session.entrySource,
          exitSource: session.exitSource,
          status: session.status,
          manualReason: session.manualReason,
        },
      ];
    });
  }
}

const instanceView = ({ instance }: Occurrence): SessionInstanceView => ({
  id: instance.id,
  scheduleId: instance.scheduleId,
  startsAt: instance.startsAt,
  endsAt: instance.endsAt,
});
