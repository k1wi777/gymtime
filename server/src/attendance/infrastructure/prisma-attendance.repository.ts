import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AttendanceFilter,
  AttendanceRepository,
} from '../domain/attendance.repository.js';
import type {
  AttendanceSession,
  AttendanceSource,
  CloseAttendanceSession,
  NewAttendanceSession,
  SessionStatus,
} from '../domain/attendance-session.js';

interface SessionRow {
  id: string;
  studentId: string;
  instanceId: string;
  enteredAt: Date;
  exitedAt: Date | null;
  entrySource: string;
  exitSource: string | null;
  status: string;
  manualReason: string | null;
}

const toDomain = (row: SessionRow): AttendanceSession => ({
  ...row,
  entrySource: row.entrySource as AttendanceSource,
  exitSource: row.exitSource as AttendanceSource | null,
  status: row.status as SessionStatus,
});

@Injectable()
export class PrismaAttendanceRepository implements AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewAttendanceSession): Promise<AttendanceSession> {
    const row = await this.prisma.attendanceSession.create({
      data: {
        ...data,
        manualReason: data.manualReason ?? null,
        status: 'abierta',
      },
    });
    return toDomain(row);
  }

  async close(
    id: string,
    data: CloseAttendanceSession,
  ): Promise<AttendanceSession | null> {
    const { count } = await this.prisma.attendanceSession.updateMany({
      where: { id, status: 'abierta' },
      data: {
        exitedAt: data.exitedAt,
        exitSource: data.exitSource,
        manualReason: data.manualReason ?? null,
        status: 'cerrada',
      },
    });
    if (count === 0) return null;
    const row = await this.prisma.attendanceSession.findUnique({
      where: { id },
    });
    return row ? toDomain(row) : null;
  }

  async findOpenByStudent(studentId: string) {
    const row = await this.prisma.attendanceSession.findFirst({
      where: { studentId, status: 'abierta' },
      orderBy: { enteredAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async listClosedInstanceIds(studentId: string) {
    const rows = await this.prisma.attendanceSession.findMany({
      where: { studentId, status: 'cerrada' },
      select: { instanceId: true },
    });
    return [...new Set(rows.map((r) => r.instanceId))];
  }

  countOpenByInstance(instanceId: string) {
    return this.prisma.attendanceSession.count({
      where: { instanceId, status: 'abierta' },
    });
  }

  async closeOpenByInstance(
    instanceId: string,
    data: { manualReason: string },
  ): Promise<number> {
    const { count } = await this.prisma.attendanceSession.updateMany({
      where: { instanceId, status: 'abierta' },
      data: {
        status: 'no_registrada',
        exitedAt: null,
        exitSource: null,
        manualReason: data.manualReason,
      },
    });
    return count;
  }

  async listOpenStudentIds() {
    const rows = await this.prisma.attendanceSession.findMany({
      where: { status: 'abierta' },
      select: { studentId: true },
    });
    return [...new Set(rows.map((r) => r.studentId))];
  }

  async list(filter: AttendanceFilter = {}) {
    const dir = filter.order === 'desc' ? 'desc' : 'asc';
    const rows = await this.prisma.attendanceSession.findMany({
      where: where(filter),
      orderBy: [{ enteredAt: dir }, { id: dir }],
      ...(filter.offset && { skip: filter.offset }),
      ...(filter.limit && { take: filter.limit }),
    });
    return rows.map(toDomain);
  }

  count(filter: AttendanceFilter = {}) {
    return this.prisma.attendanceSession.count({ where: where(filter) });
  }
}

function where(filter: AttendanceFilter) {
  return {
    ...(filter.studentId && { studentId: filter.studentId }),
    ...(filter.studentIds && { studentId: { in: filter.studentIds } }),
    ...(filter.instanceId && { instanceId: filter.instanceId }),
    ...(filter.instanceIds && { instanceId: { in: filter.instanceIds } }),
    ...(filter.source && {
      OR: [{ entrySource: filter.source }, { exitSource: filter.source }],
    }),
    ...(filter.status && { status: filter.status }),
    ...((filter.from || filter.to) && {
      enteredAt: { gte: filter.from, lte: filter.to },
    }),
  };
}
