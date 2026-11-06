import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  EventLogEntry,
  EventLogRepository,
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
}
