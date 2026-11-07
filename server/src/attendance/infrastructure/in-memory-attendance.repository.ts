import { randomUUID } from 'node:crypto';
import type {
  AttendanceFilter,
  AttendanceRepository,
} from '../domain/attendance.repository.js';
import type {
  AttendanceSession,
  CloseAttendanceSession,
  NewAttendanceSession,
} from '../domain/attendance-session.js';

export class InMemoryAttendanceRepository implements AttendanceRepository {
  private readonly rows = new Map<string, AttendanceSession>();

  async create(data: NewAttendanceSession) {
    const session: AttendanceSession = {
      id: randomUUID(),
      studentId: data.studentId,
      instanceId: data.instanceId,
      enteredAt: data.enteredAt,
      exitedAt: null,
      entrySource: data.entrySource,
      exitSource: null,
      status: 'abierta',
      manualReason: data.manualReason ?? null,
    };
    this.rows.set(session.id, session);
    return { ...session };
  }

  /** Loads sessions as they are (data loaders and tests). */
  load(sessions: AttendanceSession[]): void {
    for (const session of sessions) this.rows.set(session.id, { ...session });
  }

  async close(id: string, data: CloseAttendanceSession) {
    const current = this.rows.get(id);
    if (current?.status !== 'abierta') return null;
    const closed: AttendanceSession = {
      ...current,
      exitedAt: data.exitedAt,
      exitSource: data.exitSource,
      manualReason: data.manualReason ?? null,
      status: 'cerrada',
    };
    this.rows.set(id, closed);
    return { ...closed };
  }

  async findOpenByStudent(studentId: string) {
    const row = [...this.rows.values()]
      .filter((r) => r.studentId === studentId && r.status === 'abierta')
      .at(-1);
    return row ? { ...row } : null;
  }

  async listClosedInstanceIds(studentId: string) {
    return [
      ...new Set(
        [...this.rows.values()]
          .filter((r) => r.studentId === studentId && r.status === 'cerrada')
          .map((r) => r.instanceId),
      ),
    ];
  }

  async listClosedStudentIds(instanceId: string) {
    return [
      ...new Set(
        [...this.rows.values()]
          .filter((r) => r.instanceId === instanceId && r.status === 'cerrada')
          .map((r) => r.studentId),
      ),
    ];
  }

  async closeUnregistered(id: string, data: CloseAttendanceSession) {
    const current = this.rows.get(id);
    if (current?.status !== 'no_registrada') return null;
    const closed: AttendanceSession = {
      ...current,
      exitedAt: data.exitedAt,
      exitSource: data.exitSource,
      manualReason: data.manualReason ?? null,
      status: 'cerrada',
    };
    this.rows.set(id, closed);
    return { ...closed };
  }

  async findOfflineSession(
    studentId: string,
    kind: 'entry' | 'exit',
    at: Date,
  ) {
    const row = [...this.rows.values()].find(
      (r) =>
        r.studentId === studentId &&
        (kind === 'entry'
          ? r.entrySource === 'offline' &&
            r.enteredAt.getTime() === at.getTime()
          : r.exitSource === 'offline' &&
            r.exitedAt?.getTime() === at.getTime()),
    );
    return row ? { ...row } : null;
  }

  async countOpenByInstance(instanceId: string) {
    return [...this.rows.values()].filter(
      (r) => r.instanceId === instanceId && r.status === 'abierta',
    ).length;
  }

  async closeOpenByInstance(
    instanceId: string,
    data: { manualReason: string },
  ) {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.instanceId !== instanceId || row.status !== 'abierta') continue;
      this.rows.set(row.id, {
        ...row,
        status: 'no_registrada',
        exitedAt: null,
        exitSource: null,
        manualReason: data.manualReason,
      });
      count++;
    }
    return count;
  }

  async listOpenStudentIds() {
    return [
      ...new Set(
        [...this.rows.values()]
          .filter((r) => r.status === 'abierta')
          .map((r) => r.studentId),
      ),
    ];
  }

  async list(filter: AttendanceFilter = {}) {
    const sign = filter.order === 'desc' ? -1 : 1;
    const offset = filter.offset ?? 0;
    return this.matching(filter)
      .sort(
        (a, b) =>
          sign *
          (a.enteredAt.getTime() - b.enteredAt.getTime() ||
            a.id.localeCompare(b.id)),
      )
      .slice(
        offset,
        filter.limit === undefined ? undefined : offset + filter.limit,
      )
      .map((r) => ({ ...r }));
  }

  async count(filter: AttendanceFilter = {}) {
    return this.matching(filter).length;
  }

  private matching(filter: AttendanceFilter): AttendanceSession[] {
    return [...this.rows.values()].filter(
      (r) =>
        (!filter.studentId || r.studentId === filter.studentId) &&
        (!filter.studentIds || filter.studentIds.includes(r.studentId)) &&
        (!filter.instanceId || r.instanceId === filter.instanceId) &&
        (!filter.instanceIds || filter.instanceIds.includes(r.instanceId)) &&
        (!filter.source ||
          r.entrySource === filter.source ||
          r.exitSource === filter.source) &&
        (!filter.status || r.status === filter.status) &&
        (!filter.from || r.enteredAt >= filter.from) &&
        (!filter.to || r.enteredAt <= filter.to),
    );
  }
}
