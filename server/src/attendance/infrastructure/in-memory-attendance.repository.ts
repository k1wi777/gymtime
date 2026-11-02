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

  async countOpenByInstance(instanceId: string) {
    return [...this.rows.values()].filter(
      (r) => r.instanceId === instanceId && r.status === 'abierta',
    ).length;
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
    return [...this.rows.values()]
      .filter(
        (r) =>
          (!filter.studentId || r.studentId === filter.studentId) &&
          (!filter.instanceId || r.instanceId === filter.instanceId) &&
          (!filter.status || r.status === filter.status) &&
          (!filter.from || r.enteredAt >= filter.from) &&
          (!filter.to || r.enteredAt <= filter.to),
      )
      .sort(
        (a, b) =>
          a.enteredAt.getTime() - b.enteredAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .slice(0, filter.limit ?? undefined)
      .map((r) => ({ ...r }));
  }
}
