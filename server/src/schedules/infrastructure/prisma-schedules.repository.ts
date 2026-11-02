import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { NewSchedule, Schedule } from '../domain/schedule.js';
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

  async findByStudent(studentId: string) {
    const rows = await this.prisma.schedule.findMany({
      where: { students: { some: { studentId } } },
    });
    return rows.map(toDomain);
  }

  async assignStudent(scheduleId: string, studentId: string) {
    await this.prisma.scheduleStudent.upsert({
      where: { scheduleId_studentId: { scheduleId, studentId } },
      create: { scheduleId, studentId },
      update: {},
    });
  }

  async unassignStudent(scheduleId: string, studentId: string) {
    await this.prisma.scheduleStudent.deleteMany({
      where: { scheduleId, studentId },
    });
  }

  async listStudentIds(scheduleIds: string[]) {
    const result = new Map<string, string[]>(scheduleIds.map((id) => [id, []]));
    const rows = await this.prisma.scheduleStudent.findMany({
      where: { scheduleId: { in: scheduleIds } },
      orderBy: { studentId: 'asc' },
    });
    for (const row of rows) result.get(row.scheduleId)?.push(row.studentId);
    return result;
  }
}
