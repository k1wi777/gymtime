import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { InstancesRepository } from '../domain/instances.repository.js';
import type {
  NewScheduleInstance,
  ScheduleInstance,
} from '../domain/schedule-instance.js';

interface InstanceRow {
  id: string;
  scheduleId: string;
  date: Date;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

const toDomain = (row: InstanceRow): ScheduleInstance => ({
  id: row.id,
  scheduleId: row.scheduleId,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  status: row.status,
  date: row.date.toISOString().slice(0, 10),
});

@Injectable()
export class PrismaInstancesRepository implements InstancesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(items: NewScheduleInstance[]) {
    if (items.length === 0) return 0;
    const { count } = await this.prisma.scheduleInstance.createMany({
      data: items.map((i) => ({
        ...i,
        date: new Date(`${i.date}T00:00:00Z`),
        generatedAt: new Date(),
      })),
      skipDuplicates: true,
    });
    return count;
  }

  async findFromDate(scheduleIds: string[], fromDate: string) {
    if (scheduleIds.length === 0) return [];
    const rows = await this.prisma.scheduleInstance.findMany({
      where: {
        scheduleId: { in: scheduleIds },
        date: { gte: new Date(`${fromDate}T00:00:00Z`) },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async deleteByIds(ids: string[]) {
    if (ids.length === 0) return 0;
    // The cascade would erase attendance and alarms: the filter keeps them.
    const { count } = await this.prisma.scheduleInstance.deleteMany({
      where: { id: { in: ids }, sessions: { none: {} }, alarms: { none: {} } },
    });
    return count;
  }

  async updateTimes(id: string, startsAt: Date, endsAt: Date) {
    await this.prisma.scheduleInstance.update({
      where: { id },
      data: { startsAt, endsAt },
    });
  }

  async findInRange(from: Date, to: Date, scheduleIds?: string[]) {
    const rows = await this.prisma.scheduleInstance.findMany({
      where: {
        startsAt: { lte: to },
        endsAt: { gte: from },
        ...(scheduleIds && { scheduleId: { in: scheduleIds } }),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findByDates(from: string, to: string, scheduleIds?: string[]) {
    if (scheduleIds && scheduleIds.length === 0) return [];
    const rows = await this.prisma.scheduleInstance.findMany({
      where: {
        date: {
          gte: new Date(`${from}T00:00:00Z`),
          lte: new Date(`${to}T00:00:00Z`),
        },
        ...(scheduleIds && { scheduleId: { in: scheduleIds } }),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.scheduleInstance.findMany({
      where: { id: { in: ids } },
    });
    return rows.map(toDomain);
  }
}
