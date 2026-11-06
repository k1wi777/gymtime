import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  EventLogEntry,
  EventLogQuery,
  EventLogRepository,
  StoredEvent,
} from './event-log.repository.js';

@Injectable()
export class PrismaEventLogRepository implements EventLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(entry: EventLogEntry): Promise<void> {
    await this.prisma.eventLog.create({
      data: {
        type: entry.type,
        actorType: entry.actor.type,
        actorId: entry.actor.id,
        detail: (entry.detail ?? undefined) as
          Prisma.InputJsonValue | undefined,
      },
    });
  }

  async search(query: EventLogQuery): Promise<StoredEvent[]> {
    const rows = await this.prisma.eventLog.findMany({
      where: {
        ...(query.typePrefix && { type: { startsWith: query.typePrefix } }),
        ...(query.types && { type: { in: query.types } }),
        ...(query.actorId && { actorId: query.actorId }),
        ...(query.detailMatch && {
          OR: query.detailMatch.values.map((value) => ({
            detail: { path: [query.detailMatch!.key], equals: value },
          })),
        }),
        ...((query.from || query.to) && {
          createdAt: { gte: query.from, lte: query.to },
        }),
        ...(query.before !== undefined && { id: { lt: query.before } }),
      },
      orderBy: { id: 'desc' },
      take: query.limit,
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      actor: { type: row.actorType, id: row.actorId },
      detail: (row.detail ?? null) as Record<string, unknown> | null,
      createdAt: row.createdAt,
    }));
  }
}
