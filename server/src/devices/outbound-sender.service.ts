import { Inject, Injectable, Logger } from '@nestjs/common';
import { PROTOCOL_VERSION, type ServerMessage } from '@gymtime/shared';
import { completeLegacyDisplay } from './legacy-display.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { ConnectionRegistry } from './connection-registry.js';
import { DevicesService } from './devices.service.js';
import { DEVICES_CONFIG, type DevicesConfig } from './devices.config.js';
import type { DeviceCommand } from './domain/device-command.js';
import {
  DEVICE_COMMANDS_REPOSITORY,
  type DeviceCommandsRepository,
} from './domain/device-commands.repository.js';

export type SendResult = 'acked' | 'failed';
/** `queued`: persisted and waiting for the device to reconnect. */
export type CommandSendResult = SendResult | 'queued';

export interface SendCommandOptions {
  /**
   * Orders that set a state (the alarm) discard older unconfirmed orders of
   * the same type, so only the latest one is applied (R7).
   */
  supersedesPrevious?: boolean;
}

interface Pending {
  deviceId: string;
  message: ServerMessage;
  resends: number;
  timer: NodeJS.Timeout;
  resolve: (result: SendResult) => void;
}

interface OutstandingCommand {
  deviceId: string;
  message: ServerMessage;
  attempts: number;
  timer?: NodeJS.Timeout;
  resolve: (result: CommandSendResult) => void;
}

/**
 * Two send paths:
 * - `send` keeps the original in-memory semantics for messages that must not
 *   outlive a connection (`scan.result`, `templates.sync`, `schedule.set`).
 * - `sendCommand` persists the order in `device_commands` before transmitting
 *   it, retries with the same id and replays it when the device reconnects.
 */
@Injectable()
export class OutboundSender {
  private readonly logger = new Logger(OutboundSender.name);
  private readonly pending = new Map<string, Pending>();
  private readonly outstanding = new Map<string, OutstandingCommand>();

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly devices: DevicesService,
    @Inject(DEVICES_CONFIG) private readonly config: DevicesConfig,
    @Inject(DEVICE_COMMANDS_REPOSITORY)
    private readonly commands: DeviceCommandsRepository,
    private readonly events: SystemEventsService,
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

  async sendCommand(
    deviceId: string,
    message: ServerMessage,
    options: SendCommandOptions = {},
  ): Promise<CommandSendResult> {
    try {
      await this.devices.ensureDevice(deviceId);
      if (options.supersedesPrevious) {
        await this.supersede(deviceId, message.type);
      }
      await this.commands.create({
        id: message.id,
        deviceId,
        type: message.type,
        payload: message.payload,
        createdAt: new Date(),
      });
    } catch (error) {
      // Without a trace the order is never sent: no untracked orders.
      this.logger.error({
        event: 'command_persist_failed',
        deviceId,
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
    this.emitCommand(deviceId, message, 'pending', 0);
    if (!this.registry.get(deviceId)) {
      this.logger.warn({
        event: 'command_queued',
        deviceId,
        id: message.id,
        type: message.type,
      });
      return 'queued';
    }
    return this.deliver(deviceId, message);
  }

  /** Resolves the outbound message the device just confirmed. */
  handleAck(deviceId: string, ref: string): void {
    const command = this.outstanding.get(ref);
    if (command) {
      if (command.deviceId !== deviceId) {
        this.logger.warn({ event: 'ack_unmatched', deviceId, ref });
        return;
      }
      this.finishCommand(command, 'acked');
      return;
    }
    const entry = this.pending.get(ref);
    if (entry) {
      if (entry.deviceId !== deviceId) {
        this.logger.warn({ event: 'ack_unmatched', deviceId, ref });
        return;
      }
      this.finish(entry, 'acked');
      return;
    }
    // An ack can arrive after a restart, when no in-memory entry exists.
    void this.acknowledgePersisted(deviceId, ref);
  }

  /**
   * A connection closed: in-memory messages fail, persisted orders go back to
   * `pending` (not `failed`) so they are replayed on the next connection.
   */
  async handleDisconnect(deviceId: string): Promise<void> {
    this.failPending(deviceId);
    for (const entry of this.outstanding.values()) {
      if (entry.deviceId !== deviceId) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.outstanding.delete(entry.message.id);
      try {
        await this.commands.markPending(entry.message.id);
      } catch (error) {
        this.logger.error({
          event: 'command_requeue_failed',
          deviceId,
          id: entry.message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.emitCommand(deviceId, entry.message, 'pending', entry.attempts);
      entry.resolve('failed');
    }
  }

  /** Resends this device's pending orders, oldest first, one at a time. */
  async replayPending(deviceId: string): Promise<void> {
    let rows: DeviceCommand[];
    try {
      rows = await this.commands.findPendingForDevice(deviceId);
    } catch (error) {
      this.logger.error({
        event: 'replay_failed',
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    for (const row of rows) {
      if (this.outstanding.has(row.id)) continue;
      if (!this.registry.get(deviceId)) return;
      const result = await this.deliver(deviceId, this.rebuild(row));
      if (result === 'queued' || !this.registry.get(deviceId)) return;
    }
  }

  /** After a restart nothing is in flight: `sent` rows were never confirmed. */
  resetSentToPending(): Promise<number> {
    return this.commands.resetSentToPending();
  }

  /** Fails every in-memory message of a device whose connection closed. */
  private failPending(deviceId: string): void {
    for (const entry of this.pending.values()) {
      if (entry.deviceId === deviceId) this.finish(entry, 'failed');
    }
  }

  private deliver(
    deviceId: string,
    message: ServerMessage,
  ): Promise<CommandSendResult> {
    return new Promise<CommandSendResult>((resolve) => {
      const entry: OutstandingCommand = {
        deviceId,
        message,
        attempts: 0,
        resolve,
      };
      this.outstanding.set(message.id, entry);
      this.transmit(entry);
    });
  }

  private transmit(entry: OutstandingCommand): void {
    const connection = this.registry.get(entry.deviceId);
    if (!connection) {
      this.outstanding.delete(entry.message.id);
      entry.resolve('queued');
      return;
    }
    entry.attempts += 1;
    void this.commands
      .markSent(entry.message.id, entry.attempts)
      .catch((error: unknown) =>
        this.logger.error({
          event: 'command_persist_failed',
          deviceId: entry.deviceId,
          id: entry.message.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    this.logger.log({
      event: 'command_sent',
      deviceId: entry.deviceId,
      id: entry.message.id,
      type: entry.message.type,
      attempt: entry.attempts,
    });
    connection.send(entry.message);
    entry.timer = setTimeout(
      () => this.onCommandTimeout(entry.message.id),
      this.config.ackTimeoutMs,
    );
    this.emitCommand(entry.deviceId, entry.message, 'sent', entry.attempts);
  }

  private onCommandTimeout(id: string): void {
    const entry = this.outstanding.get(id);
    if (!entry) return;
    if (entry.attempts >= this.config.maxResends + 1) {
      this.outstanding.delete(id);
      void this.commands.markFailed(id).catch((error: unknown) =>
        this.logger.error({
          event: 'command_persist_failed',
          deviceId: entry.deviceId,
          id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      this.emitCommand(entry.deviceId, entry.message, 'failed', entry.attempts);
      this.logger.warn({
        event: 'command_attempts_exhausted',
        deviceId: entry.deviceId,
        id,
        attempts: entry.attempts,
      });
      entry.resolve('failed');
      return;
    }
    this.logger.warn({
      event: 'command_resend',
      deviceId: entry.deviceId,
      id,
      attempt: entry.attempts + 1,
    });
    this.transmit(entry);
  }

  private finishCommand(
    entry: OutstandingCommand,
    result: CommandSendResult,
  ): void {
    if (entry.timer) clearTimeout(entry.timer);
    this.outstanding.delete(entry.message.id);
    if (result === 'acked') {
      void this.commands.markAcked(entry.message.id).catch((error: unknown) =>
        this.logger.error({
          event: 'command_persist_failed',
          deviceId: entry.deviceId,
          id: entry.message.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      this.emitCommand(entry.deviceId, entry.message, 'acked', entry.attempts);
    }
    entry.resolve(result);
  }

  private async acknowledgePersisted(
    deviceId: string,
    ref: string,
  ): Promise<void> {
    try {
      const command = await this.commands.findById(ref);
      if (
        !command ||
        command.deviceId !== deviceId ||
        (command.status !== 'pending' && command.status !== 'sent')
      ) {
        this.logger.warn({ event: 'ack_unmatched', deviceId, ref });
        return;
      }
      await this.commands.markAcked(ref);
      this.emitCommand(
        deviceId,
        { id: ref, type: command.type } as ServerMessage,
        'acked',
        command.attempts,
      );
    } catch (error) {
      this.logger.error({
        event: 'ack_persist_failed',
        deviceId,
        ref,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Marks older unconfirmed orders of the same type as failed (R7). */
  private async supersede(deviceId: string, type: string): Promise<void> {
    const rows = await this.commands.findUnconfirmedForDevice(deviceId, type);
    const remaining = new Set(rows.map((row) => row.id));
    for (const entry of this.outstanding.values()) {
      if (entry.deviceId !== deviceId || entry.message.type !== type) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.outstanding.delete(entry.message.id);
      remaining.delete(entry.message.id);
      await this.commands.markFailed(entry.message.id);
      this.emitCommand(deviceId, entry.message, 'failed', entry.attempts);
      entry.resolve('failed');
    }
    for (const row of rows) {
      if (!remaining.has(row.id)) continue;
      await this.commands.markFailed(row.id);
      this.emitCommand(
        deviceId,
        { id: row.id, type: row.type } as ServerMessage,
        'failed',
        row.attempts,
      );
    }
  }

  private rebuild(command: DeviceCommand): ServerMessage {
    return {
      v: PROTOCOL_VERSION,
      id: command.id,
      type: command.type,
      ts: Math.floor(Date.now() / 1000),
      ref: null,
      payload:
        command.type === 'display.message'
          ? completeLegacyDisplay(command.payload)
          : command.payload,
    } as ServerMessage;
  }

  private emitCommand(
    deviceId: string,
    message: Pick<ServerMessage, 'id' | 'type'>,
    status: 'pending' | 'sent' | 'acked' | 'failed',
    attempts: number,
  ): void {
    this.events.emit('command', {
      deviceId,
      commandId: message.id,
      commandType: message.type,
      status,
      attempts,
    });
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
