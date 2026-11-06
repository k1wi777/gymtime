import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PROTOCOL_VERSION,
  parseDeviceMessage,
  uuidSchema,
  type AckError,
  type AckMessage,
  type DeviceMessage,
  type ServerMessage,
} from '@gymtime/shared';
import { deviceActor, runAsActor } from '../common/audit/actor.js';
import { safeEqual } from '../common/auth/safe-equal.js';
import type { Env } from '../config/env.schema.js';
import { DEVICES_CONFIG, type DevicesConfig } from './devices.config.js';
import { DevicesService } from './devices.service.js';
import { OutboundSender } from './outbound-sender.service.js';
import {
  PROCESSED_MESSAGES_REPOSITORY,
  type ProcessedMessagesRepository,
} from './domain/processed-messages.repository.js';

/** What the gateway must do after a frame has been processed. */
export type Action =
  | { kind: 'send'; message: ServerMessage }
  | { kind: 'authenticated'; deviceId: string; firmwareVersion: string }
  | { kind: 'close'; code: number; reason: string };

/** State of one connection; `deviceId` is null until a valid hello. */
export interface Session {
  deviceId: string | null;
}

export type MessageHandler = (
  deviceId: string,
  message: DeviceMessage,
) => Promise<void> | void;

export const CLOSE_UNAUTHORIZED = 4401;

/**
 * Socket-free core of the gateway: validation, authentication, idempotency and
 * ack. Message types without a registered handler are only logged and acked.
 */
@Injectable()
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);
  private readonly handlers = new Map<string, MessageHandler>();

  constructor(
    private readonly devices: DevicesService,
    private readonly sender: OutboundSender,
    private readonly config: ConfigService<Env, true>,
    @Inject(DEVICES_CONFIG) private readonly devicesConfig: DevicesConfig,
    @Inject(PROCESSED_MESSAGES_REPOSITORY)
    private readonly processed: ProcessedMessagesRepository,
  ) {}

  /** Extension point for the modules that act on device messages. */
  registerHandler(type: DeviceMessage['type'], handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  async process(session: Session, raw: string): Promise<Action[]> {
    const parsed = parseDeviceMessage(raw);
    if (!parsed.ok) return this.rejectInvalid(session, raw, parsed);

    const message = parsed.message;
    this.logger.log({
      event: 'message_received',
      deviceId: session.deviceId,
      type: message.type,
      id: message.id,
      ref: message.ref,
    });

    if (message.type === 'hello') return this.handleHello(session, message);
    if (!session.deviceId) {
      return [this.sendAck(message.id, false, 'NOT_AUTHENTICATED')];
    }
    if (message.type === 'ack') {
      if (message.ref) this.sender.handleAck(session.deviceId, message.ref);
      return [];
    }
    return this.handleIdempotent(session.deviceId, message);
  }

  private rejectInvalid(
    session: Session,
    raw: string,
    failure: { code: AckError; reason: string },
  ): Action[] {
    const id = recoverId(raw);
    this.logger.warn({
      event: 'message_invalid',
      deviceId: session.deviceId,
      id,
      code: failure.code,
      reason: failure.reason,
    });
    // Without a recoverable UUID there is no valid `ref` for an ack.
    return id ? [this.sendAck(id, false, failure.code)] : [];
  }

  private async handleHello(
    session: Session,
    hello: Extract<DeviceMessage, { type: 'hello' }>,
  ): Promise<Action[]> {
    const { deviceId, token, fw } = hello.payload;
    const expected = this.config.get('DEVICE_TOKEN', { infer: true });
    if (!safeEqual(token, expected)) {
      this.logger.warn({ event: 'auth_failed', deviceId, id: hello.id });
      return [
        this.sendAck(hello.id, false, 'UNAUTHORIZED'),
        { kind: 'close', code: CLOSE_UNAUTHORIZED, reason: 'unauthorized' },
      ];
    }
    const actions: Action[] = [];
    // A repeated hello answers again without touching state (R7).
    if (!session.deviceId) {
      await this.devices.markOnline(deviceId, fw);
      this.logger.log({ event: 'auth_ok', deviceId, fw });
      actions.push({ kind: 'authenticated', deviceId, firmwareVersion: fw });
    }
    actions.push({
      kind: 'send',
      message: {
        v: PROTOCOL_VERSION,
        id: randomUUID(),
        type: 'hello.ok',
        ts: nowSeconds(),
        ref: hello.id,
        payload: {
          serverTime: nowSeconds(),
          heartbeatSec: this.devicesConfig.heartbeatSec,
        },
      },
    });
    return actions;
  }

  private async handleIdempotent(
    deviceId: string,
    message: Exclude<DeviceMessage, { type: 'hello' | 'ack' }>,
  ): Promise<Action[]> {
    const previous = await this.processed.findAck(deviceId, message.id);
    if (previous) {
      this.logger.log({
        event: 'duplicate',
        deviceId,
        type: message.type,
        id: message.id,
      });
      return [{ kind: 'send', message: previous }];
    }
    try {
      // Handlers run before the record is saved, so a failure leaves the id
      // unprocessed and a retry runs it again: handlers must be idempotent.
      const handler = this.handlers.get(message.type);
      // The audit trail attributes whatever the handler does to the device.
      if (handler) {
        await runAsActor(deviceActor(deviceId), () =>
          handler(deviceId, message),
        );
      } else
        this.logger.debug({
          event: 'no_handler',
          deviceId,
          type: message.type,
        });
      const ack = buildAck(message.id, true);
      await this.processed.save(deviceId, message.id, ack);
      return [{ kind: 'send', message: ack }];
    } catch (error) {
      this.logger.error({
        event: 'processing_failed',
        deviceId,
        type: message.type,
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return [this.sendAck(message.id, false, 'INTERNAL_ERROR')];
    }
  }

  private sendAck(ref: string, ok: boolean, error?: AckError): Action {
    return { kind: 'send', message: buildAck(ref, ok, error) };
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function buildAck(ref: string, ok: boolean, error?: AckError): AckMessage {
  return {
    v: PROTOCOL_VERSION,
    id: randomUUID(),
    type: 'ack',
    ts: nowSeconds(),
    ref,
    payload: error ? { ok, error } : { ok },
  };
}

/** Best-effort extraction of a UUID `id` from a frame that failed validation. */
function recoverId(raw: string): string | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const id = (value as Record<string, unknown>)['id'];
    const result = uuidSchema.safeParse(id);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
