import type { AckMessage } from '@gymtime/shared';
import type { ProcessedMessagesRepository } from '../domain/processed-messages.repository.js';

export class InMemoryProcessedMessagesRepository implements ProcessedMessagesRepository {
  private readonly acks = new Map<string, AckMessage>();

  async findAck(deviceId: string, messageId: string) {
    return this.acks.get(`${deviceId}:${messageId}`) ?? null;
  }

  async save(deviceId: string, messageId: string, ack: AckMessage) {
    const key = `${deviceId}:${messageId}`;
    if (!this.acks.has(key)) this.acks.set(key, ack);
  }
}
