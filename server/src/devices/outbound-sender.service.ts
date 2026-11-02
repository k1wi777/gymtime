import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ServerMessage } from '@gymtime/shared';
import { ConnectionRegistry } from './connection-registry.js';
import { DEVICES_CONFIG, type DevicesConfig } from './devices.config.js';

export type SendResult = 'acked' | 'failed';

interface Pending {
  deviceId: string;
  message: ServerMessage;
  resends: number;
  timer: NodeJS.Timeout;
  resolve: (result: SendResult) => void;
}

/**
 * Sends server messages that need confirmation, resending with the same id
 * until the device acks. In memory only: persistence is E2-4.
 */
@Injectable()
export class OutboundSender {
  private readonly logger = new Logger(OutboundSender.name);
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly registry: ConnectionRegistry,
    @Inject(DEVICES_CONFIG) private readonly config: DevicesConfig,
  ) {}

  send(deviceId: string, message: ServerMessage): Promise<SendResult> {
    const connection = this.registry.get(deviceId);
    if (!connection) {
      this.logger.warn({
        event: 'send_failed',
        reason: 'no_connection',
        deviceId,
        id: message.id,
      });
      return Promise.resolve('failed');
    }
    return new Promise<SendResult>((resolve) => {
      const entry: Pending = {
        deviceId,
        message,
        resends: 0,
        resolve,
        timer: this.startTimer(message.id),
      };
      this.pending.set(message.id, entry);
      connection.send(message);
    });
  }

  /** Resolves the outbound message the device just confirmed. */
  handleAck(deviceId: string, ref: string): void {
    const entry = this.pending.get(ref);
    if (!entry || entry.deviceId !== deviceId) {
      this.logger.warn({ event: 'ack_unmatched', deviceId, ref });
      return;
    }
    this.finish(entry, 'acked');
  }

  /** Fails every pending message of a device whose connection closed. */
  failPending(deviceId: string): void {
    for (const entry of this.pending.values()) {
      if (entry.deviceId === deviceId) this.finish(entry, 'failed');
    }
  }

  private startTimer(id: string): NodeJS.Timeout {
    return setTimeout(() => this.onTimeout(id), this.config.ackTimeoutMs);
  }

  private onTimeout(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    const connection = this.registry.get(entry.deviceId);
    if (!connection || entry.resends >= this.config.maxResends) {
      this.logger.warn({
        event: 'resend_exhausted',
        deviceId: entry.deviceId,
        id,
        resends: entry.resends,
      });
      this.finish(entry, 'failed');
      return;
    }
    entry.resends += 1;
    this.logger.warn({
      event: 'resend',
      deviceId: entry.deviceId,
      id,
      attempt: entry.resends,
    });
    connection.send(entry.message);
    entry.timer = this.startTimer(id);
  }

  private finish(entry: Pending, result: SendResult): void {
    clearTimeout(entry.timer);
    this.pending.delete(entry.message.id);
    entry.resolve(result);
  }
}
