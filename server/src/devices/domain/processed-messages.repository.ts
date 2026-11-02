import type { AckMessage } from '@gymtime/shared';

export interface ProcessedMessagesRepository {
  /** Returns the ack stored for a message already processed, if any. */
  findAck(deviceId: string, messageId: string): Promise<AckMessage | null>;
  /** Records the message; a duplicate `(deviceId, messageId)` is ignored. */
  save(deviceId: string, messageId: string, ack: AckMessage): Promise<void>;
}

export const PROCESSED_MESSAGES_REPOSITORY = Symbol(
  'PROCESSED_MESSAGES_REPOSITORY',
);
