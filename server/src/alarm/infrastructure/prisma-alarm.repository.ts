import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AlarmClosedBy,
  AlarmEvent,
  CloseAlarmEvent,
  NewAlarmEvent,
} from '../domain/alarm-event.js';
import type {
  AlarmHistoryFilter,
  AlarmRepository,
} from '../domain/alarm.repository.js';

interface AlarmRow {
  id: string;
  instanceId: string;
  startedAt: Date;
  endedAt: Date | null;
  closedBy: string | null;
  closedSessions: number;
}

const toDomain = (row: AlarmRow): AlarmEvent => ({
  ...row,
  closedBy: row.closedBy as AlarmClosedBy | null,
});

@Injectable()
export class PrismaAlarmRepository implements AlarmRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewAlarmEvent): Promise<AlarmEvent> {
    const row = await this.prisma.alarmEvent.create({ data });
    return toDomain(row);
  }

  async findOpen(): Promise<AlarmEvent[]> {
    const rows = await this.prisma.alarmEvent.findMany({
      where: { endedAt: null },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findOpenByInstance(instanceId: string): Promise<AlarmEvent | null> {
    const row = await this.prisma.alarmEvent.findFirst({
      where: { instanceId, endedAt: null },
      orderBy: { startedAt: 'asc' },
    });
    return row ? toDomain(row) : null;
  }

  async instanceIdsWithEvents(instanceIds: string[]) {
    if (instanceIds.length === 0) return [];
    const rows = await this.prisma.alarmEvent.findMany({
      where: { instanceId: { in: instanceIds } },
      select: { instanceId: true },
      distinct: ['instanceId'],
    });
    return rows.map((row) => row.instanceId);
  }

  async findByInstanceIds(instanceIds: string[]) {
    if (instanceIds.length === 0) return [];
    const rows = await this.prisma.alarmEvent.findMany({
      where: { instanceId: { in: instanceIds } },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async list(filter: AlarmHistoryFilter) {
    const where = {
      ...((filter.from || filter.to) && {
        startedAt: { gte: filter.from, lte: filter.to },
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.alarmEvent.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: filter.offset,
        take: filter.limit,
      }),
      this.prisma.alarmEvent.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async close(id: string, data: CloseAlarmEvent): Promise<AlarmEvent | null> {
    const { count } = await this.prisma.alarmEvent.updateMany({
      where: { id, endedAt: null },
      data: {
        endedAt: data.endedAt,
        closedBy: data.closedBy,
        closedSessions: data.closedSessions,
      },
    });
    if (count === 0) return null;
    const row = await this.prisma.alarmEvent.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }
}
