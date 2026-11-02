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
  ...row,
  date: row.date.toISOString().slice(0, 10),
});

@Injectable()
export class PrismaInstancesRepository implements InstancesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(items: NewScheduleInstance[]) {
    if (items.length === 0) return 0;
    const { count } = await this.prisma.scheduleInstance.createMany({
      data: items.map((i) => ({ ...i, date: new Date(`${i.date}T00:00:00Z`) })),
      skipDuplicates: true,
    });
    return count;
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

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.scheduleInstance.findMany({
      where: { id: { in: ids } },
    });
    return rows.map(toDomain);
  }
}
