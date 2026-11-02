import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  PROTOCOL_VERSION,
  parseDeviceMessage,
  parseServerMessage,
  uuidSchema,
  type AckError,
  type DeviceMessage,
  type ServerMessage,
} from '@gymtime/shared';
import { Backoff, Dedupe } from './backoff.js';
import type { SimulatorConfig } from './config.js';
import { EnrollmentSimulator } from './enrollment-simulator.js';
import type { Logger } from './logger.js';
import { Sender } from './sender.js';

export type ClientState =
  'connecting' | 'authenticating' | 'online' | 'backoff';

export interface DeviceClientOptions {
  /** Current time in milliseconds. */
  now?: () => number;
  ackTimeoutMs?: number;
  maxResends?: number;
  /** Reconnect schedule; tests inject a fast one. */
  backoff?: Backoff;
}

type FrameInput = Pick<DeviceMessage, 'type' | 'payload'> & {
  ref?: string | null;
};

/**
 * Simulated ESP32: speaks protocol v0 with the gateway, keeps itself online
 * and reconnects. It has no process side effects (see `main.ts`).
 */
export class DeviceClient {
  private readonly now: () => number;
  private readonly backoff: Backoff;
  private readonly processed = new Dedupe();
  private readonly sender: Sender;
  private readonly enrollment: EnrollmentSimulator;
  private readonly startedAt: number;
  private socket: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private stopped = false;
  private currentState: ClientState = 'backoff';

  constructor(
    private readonly config: SimulatorConfig,
    private readonly logger: Logger,
    options: DeviceClientOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.backoff = options.backoff ?? new Backoff();
    this.startedAt = this.now();
    this.sender = new Sender(
      {
        transmit: (raw, isResend) => this.write(raw, isResend),
        onGiveUp: (id) => this.giveUp(id),
      },
      options.ackTimeoutMs,
      options.maxResends,
    );
    this.enrollment = new EnrollmentSimulator(
      (type, payload) => this.sendTracked({ type, payload } as FrameInput),
      config.enroll,
      (text) => this.logger.state(text),
    );
  }

  get state(): ClientState {
    return this.currentState;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Closes the socket and stops reconnecting; resolves once it is closed. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    this.sender.clear();
    this.enrollment.stop();
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) =>
      socket.once('close', resolve),
    );
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket.close();
    await closed;
  }

  private setState(state: ClientState, detail = ''): void {
    this.currentState = state;
    this.logger.state(detail ? `${state}: ${detail}` : state);
  }

  private connect(): void {
    this.reconnect = null;
    this.setState('connecting', this.config.url);
    const socket = new WebSocket(this.config.url);
    this.socket = socket;
    socket.on('open', () => this.onOpen());
    socket.on('message', (data) => this.onMessage(rawToString(data)));
    socket.on('error', (error) =>
      this.logger.warn(`socket error: ${error.message}`),
    );
    socket.on('close', (code) => this.onClose(socket, code));
  }

  private onOpen(): void {
    this.setState('authenticating');
    this.sendTracked({
      type: 'hello',
      payload: {
        deviceId: this.config.deviceId,
        token: this.config.token,
        fw: this.config.fw,
      },
    });
  }

  private onClose(socket: WebSocket, code: number): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.clearTimers();
    this.sender.clear();
    this.enrollment.stop();
    if (this.stopped) {
      this.logger.state(`disconnected (code ${code})`);
      return;
    }
    const delay = this.backoff.next();
    this.setState(
      'backoff',
      `disconnected (code ${code}), retry in ${delay} ms`,
    );
    this.reconnect = setTimeout(() => this.connect(), delay);
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnect) clearTimeout(this.reconnect);
    this.heartbeat = null;
    this.reconnect = null;
  }

  private onMessage(raw: string): void {
    this.logger.frame('in', raw);
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) {
      this.rejectInvalid(raw, parsed.code, parsed.reason);
      return;
    }
    const message = parsed.message;
    switch (message.type) {
      case 'hello.ok':
        this.onHelloOk(message);
        break;
      case 'ack':
        this.onAck(message);
        break;
      default:
        this.onServerMessage(message);
    }
  }

  private onHelloOk(
    message: Extract<ServerMessage, { type: 'hello.ok' }>,
  ): void {
    this.sender.confirm(message.ref);
    this.backoff.reset();
    this.setState(
      'online',
      `heartbeat every ${message.payload.heartbeatSec} s`,
    );
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.sendStatus();
    this.heartbeat = setInterval(
      () => this.sendStatus(),
      message.payload.heartbeatSec * 1000,
    );
  }

  private onAck(message: Extract<ServerMessage, { type: 'ack' }>): void {
    this.sender.confirm(message.ref);
    if (message.payload.ok) return;
    if (message.payload.error === 'UNAUTHORIZED') {
      this.logger.warn('hello rejected: UNAUTHORIZED (wrong device token)');
    } else {
      this.logger.warn(
        `server rejected ${message.ref}: ${message.payload.error}`,
      );
    }
  }

  /** Handles any other valid server message: log it and ack it once. */
  private onServerMessage(message: ServerMessage): void {
    const duplicate = this.processed.has(message.id);
    if (duplicate) {
      this.logger.state(
        `duplicate ${message.type} ${message.id}, acking again`,
      );
    } else {
      this.processed.add(message.id);
      this.logger.state(`received ${message.type} ${message.id}`);
    }
    this.sendAck(message.id, { ok: true });
    if (!duplicate) this.dispatch(message);
  }

  /** Reacts to the server messages the simulated device implements. */
  private dispatch(message: ServerMessage): void {
    switch (message.type) {
      case 'enroll.start':
        this.enrollment.start(message.payload);
        break;
      case 'enroll.cancel':
        this.enrollment.cancel(message.payload);
        break;
    }
  }

  private rejectInvalid(raw: string, code: AckError, reason: string): void {
    const id = recoverId(raw);
    if (!id) {
      this.logger.warn(`discarded invalid message (${code}): ${reason}`);
      return;
    }
    this.logger.warn(`invalid message ${id} (${code}): ${reason}`);
    this.sendAck(id, { ok: false, error: code });
  }

  private sendStatus(): void {
    const uptime = Math.floor((this.now() - this.startedAt) / 1000);
    this.sendTracked({
      type: 'status',
      payload: { uptime, heap: 180_000, rssi: -55, fingerprintCount: 0 },
    });
  }

  private sendAck(
    ref: string,
    payload: { ok: boolean; error?: AckError },
  ): void {
    this.write(this.build({ type: 'ack', payload, ref }).raw, false);
  }

  private sendTracked(input: FrameInput): void {
    const { id, raw } = this.build(input);
    this.sender.send(id, raw);
  }

  /** Builds a frame and validates it so the simulator never emits bad traffic. */
  private build(input: FrameInput): { id: string; raw: string } {
    const id = randomUUID();
    const frame = {
      v: PROTOCOL_VERSION,
      id,
      type: input.type,
      ts: Math.floor(this.now() / 1000),
      ref: input.ref ?? null,
      payload: input.payload,
    };
    const check = parseDeviceMessage(frame);
    if (!check.ok)
      throw new Error(`built an invalid ${input.type}: ${check.reason}`);
    return { id, raw: JSON.stringify(frame) };
  }

  private write(raw: string, isResend: boolean): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.logger.frame('out', raw, isResend ? 'resend' : undefined);
    this.socket.send(raw);
  }

  private giveUp(id: string): void {
    this.logger.warn(`no ack for ${id} after resends, closing to reconnect`);
    this.socket?.terminate();
  }
}

/** Extracts a usable message id from a raw frame that failed validation. */
function recoverId(raw: string): string | null {
  try {
    const id = (JSON.parse(raw) as { id?: unknown } | null)?.id;
    const result = uuidSchema.safeParse(id);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function rawToString(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
