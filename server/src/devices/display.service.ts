import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  PROTOCOL_VERSION,
  validateDisplayLines,
  type ServerMessage,
} from '@gymtime/shared';
import { EventLogService } from '../common/audit/event-log.service.js';
import {
  DISPLAY_CONFIG,
  type DisplayConfig,
} from '../config/display.config.js';
import { DevicesService } from './devices.service.js';
import { DisplayValidationError } from '../common/display/display.errors.js';
import { NoDeviceError } from './domain/no-device.error.js';
import {
  OutboundSender,
  type CommandSendResult,
  type SendCommandOptions,
} from './outbound-sender.service.js';

export interface DisplayRequest {
  /** Target device; defaults to the only online (or only known) one. */
  deviceId?: string;
  line1: string;
  line2?: string;
  /** Seconds on screen; defaults to DISPLAY_RESULT_SECONDS. */
  durationSec?: number;
}

export interface DisplayOutcome {
  commandId: string;
  deviceId: string;
  status: CommandSendResult;
}

export interface ShowOptions extends SendCommandOptions {
  /** False for the messages the server composes itself (the alarm). */
  audit?: boolean;
}

/**
 * Sends `display.message` orders. They go through `OutboundSender.sendCommand`,
 * so they are persisted, retried and replayed when the device reconnects.
 */
@Injectable()
export class DisplayService {
  constructor(
    private readonly devices: DevicesService,
    private readonly sender: OutboundSender,
    private readonly eventLog: EventLogService,
    @Inject(DISPLAY_CONFIG) private readonly config: DisplayConfig,
  ) {}

  /**
   * Validates, persists and sends the message; resolves when the device
   * confirmed it, the order was queued (device offline) or it failed.
   * @throws DisplayValidationError when the lines do not fit the screen.
   * @throws NoDeviceError when there is no device to address.
   */
  async show(
    request: DisplayRequest,
    options: ShowOptions = {},
  ): Promise<DisplayOutcome> {
    const checked = validateDisplayLines(
      [request.line1, request.line2 ?? ''],
      this.config,
    );
    if (!checked.ok) throw new DisplayValidationError(checked.errors);
    const [line1, line2] = checked.lines;
    const deviceId = request.deviceId ?? (await this.defaultDevice());
    const durationSec = request.durationSec ?? this.config.resultSeconds;

    const message = {
      v: PROTOCOL_VERSION,
      id: randomUUID(),
      type: 'display.message',
      ts: Math.floor(Date.now() / 1000),
      ref: null,
      payload: { line1, line2, durationSec },
    } as ServerMessage;
    const status = await this.sender.sendCommand(deviceId, message, {
      supersedesPrevious: options.supersedesPrevious,
    });
    if (options.audit !== false) {
      await this.eventLog.record('display.message_sent', {
        commandId: message.id,
        deviceId,
        line1,
        line2,
        durationSec,
        status,
      });
    }
    return { commandId: message.id, deviceId, status };
  }

  /** The device the alarm uses: the one online, else the only one known. */
  async defaultDevice(): Promise<string> {
    const deviceId =
      (await this.devices.getOnlineDeviceId()) ??
      (await this.devices.getOnlyDeviceId());
    if (!deviceId) throw new NoDeviceError();
    return deviceId;
  }
}
