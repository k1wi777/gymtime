import { Injectable } from '@nestjs/common';
import { ackSchema, type AckMessage } from '@gymtime/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { ProcessedMessagesRepository } from '../domain/processed-messages.repository.js';

@Injectable()
export class PrismaProcessedMessagesRepository implements ProcessedMessagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAck(deviceId: string, messageId: string) {
    const row = await this.prisma.processedMessage.findUnique({
      where: { deviceId_messageId: { deviceId, messageId } },
    });
    if (!row) return null;
    const parsed = ackSchema.safeParse(row.response);
    return parsed.success ? parsed.data : null;
  }

  async save(deviceId: string, messageId: string, ack: AckMessage) {
    await this.prisma.processedMessage.createMany({
      data: [{ deviceId, messageId, response: ack as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
  }
}
