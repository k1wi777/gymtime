import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  NewSchedule,
  Schedule,
  SchedulePatch,
} from '../domain/schedule.js';
import type { SchedulesRepository } from '../domain/schedules.repository.js';

interface ScheduleRow {
  id: string;
  name: string;
  weekday: number | null;
  date: Date | null;
  startTime: Date;
  endTime: Date;
  entryOpenMinutes: number | null;
  entryCloseMinutes: number | null;
  periodId: string | null;
}

// Prisma maps TIME to a Date on 1970-01-01 (UTC) and DATE to UTC midnight.
const timeToDate = (time: string) => new Date(`1970-01-01T${time}Z`);
const dateToDate = (date: string) => new Date(`${date}T00:00:00Z`);

function toDomain(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    name: row.name,
    weekday: row.weekday,
    date: row.date ? row.date.toISOString().slice(0, 10) : null,
    startTime: row.startTime.toISOString().slice(11, 19),
    endTime: row.endTime.toISOString().slice(11, 19),
    entryOpenMinutes: row.entryOpenMinutes,
    entryCloseMinutes: row.entryCloseMinutes,
    periodId: row.periodId,
  };
}

@Injectable()
export class PrismaSchedulesRepository implements SchedulesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewSchedule) {
    const row = await this.prisma.schedule.create({
      data: {
        ...data,
        date: data.date ? dateToDate(data.date) : null,
        startTime: timeToDate(data.startTime),
        endTime: timeToDate(data.endTime),
      },
    });
    return toDomain(row);
  }

  async findById(id: string) {
    const row = await this.prisma.schedule.findUnique({ where: { id } });
    return row && toDomain(row);
  }

  async findAll() {
    const rows = await this.prisma.schedule.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findByPeriod(periodId: string) {
    const rows = await this.prisma.schedule.findMany({
      where: { periodId },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async update(id: string, patch: SchedulePatch) {
    try {
      const row = await this.prisma.schedule.update({
        where: { id },
        data: {
          ...patch,
          ...(patch.startTime !== undefined && {
            startTime: timeToDate(patch.startTime),
          }),
          ...(patch.endTime !== undefined && {
            endTime: timeToDate(patch.endTime),
          }),
        },
      });
      return toDomain(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return null;
      }
      throw error;
    }
  }

  async delete(id: string) {
    const { count } = await this.prisma.schedule.deleteMany({ where: { id } });
    return count > 0;
  }

  async findByStudent(studentId: string, at: Date) {
    const rows = await this.prisma.schedule.findMany({
      where: { students: { some: { studentId, ...activeAt(at) } } },
    });
    return rows.map(toDomain);
  }

  async assignStudent(scheduleId: string, studentId: string, at: Date) {
    const open = await this.prisma.scheduleStudent.findFirst({
      where: { scheduleId, studentId, validTo: null },
      select: { id: true },
    });
    if (open) return false;
    try {
      await this.prisma.scheduleStudent.create({
        data: { scheduleId, studentId, validFrom: at },
      });
      return true;
    } catch (error) {
      // A concurrent request won: the partial unique index allows one open row.
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async unassignStudent(scheduleId: string, studentId: string, at: Date) {
    const { count } = await this.prisma.scheduleStudent.updateMany({
      where: { scheduleId, studentId, validTo: null },
      data: { validTo: at },
    });
    return count > 0;
  }

  async listStudentIds(scheduleIds: string[], at: Date) {
    const result = new Map<string, string[]>(scheduleIds.map((id) => [id, []]));
    const rows = await this.prisma.scheduleStudent.findMany({
      where: { scheduleId: { in: scheduleIds }, ...activeAt(at) },
      orderBy: { studentId: 'asc' },
    });
    for (const row of rows) result.get(row.scheduleId)?.push(row.studentId);
    return result;
  }

  listAssignments(scheduleId: string) {
    return this.prisma.scheduleStudent.findMany({
      where: { scheduleId },
      orderBy: [{ validFrom: 'asc' }, { id: 'asc' }],
    });
  }
}

/** Interval active at `at`: started and not yet closed. */
const activeAt = (at: Date) => ({
  validFrom: { lte: at },
  OR: [{ validTo: null }, { validTo: { gt: at } }],
});

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';
