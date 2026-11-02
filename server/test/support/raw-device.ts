import { randomUUID } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  type DeviceMessage,
  type ServerMessage,
} from '@gymtime/shared';
import WebSocket from 'ws';

export interface RawDeviceOptions {
  /** `ws://host:port/device` */
  url: string;
  deviceId: string;
  token: string;
  fw?: string;
  /**
   * Confirms every server order automatically (default). The retry test turns
   * it off to observe the resends of the sender with the same id.
   */
  autoAck?: boolean;
  /** Timeout of the initial `hello.ok`. */
  helloTimeoutMs?: number;
}

type Payload<T extends DeviceMessage['type']> = Extract<
  DeviceMessage,
  { type: T }
>['payload'];

/**
 * Minimal protocol client for the cases the simulator cannot express:
 * `fingerprint.unknown` (A4) and repeating the same frame id (A10). It speaks
 * only `hello` and records everything the server sends, with its id, so a test
 * can assert on acks and on the exact frame the server replayed.
 */
export class RawDevice {
  private readonly received: ServerMessage[] = [];

  private constructor(
    private readonly ws: WebSocket,
    private readonly autoAck: boolean,
  ) {
    ws.on('message', (data) => this.onMessage(rawToString(data)));
  }

  /** Opens the socket, sends `hello` and waits for `hello.ok`. */
  static async connect(options: RawDeviceOptions): Promise<RawDevice> {
    const ws = new WebSocket(options.url);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const device = new RawDevice(ws, options.autoAck ?? true);
    const hello = device.send('hello', {
      deviceId: options.deviceId,
      token: options.token,
      fw: options.fw ?? 'raw-test',
    });
    await device.waitFor(
      'hello.ok',
      (message) => message.ref === hello,
      options.helloTimeoutMs ?? 2000,
    );
    return device;
  }

  /** Every server frame received so far, in order. */
  get frames(): readonly ServerMessage[] {
    return this.received;
  }

  /** Sends one frame and returns its id (fixed by the caller when given). */
  send<T extends DeviceMessage['type']>(
    type: T,
    payload: Payload<T>,
    id?: string,
  ): string {
    const frameId = id ?? randomUUID();
    this.write({ type, payload, ref: null, id: frameId });
    return frameId;
  }

  /** Confirms a server order by its id. */
  ack(ref: string): void {
    this.write({ type: 'ack', payload: { ok: true }, ref });
  }

  /** Server frames of one type, in arrival order. */
  framesOf<T extends ServerMessage['type']>(
    type: T,
  ): Array<Extract<ServerMessage, { type: T }>> {
    return this.received.filter(
      (message): message is Extract<ServerMessage, { type: T }> =>
        message.type === type,
    );
  }

  /** Waits for the first frame of `type` that matches, polling briefly. */
  waitFor<T extends ServerMessage['type']>(
    type: T,
    match: (message: Extract<ServerMessage, { type: T }>) => boolean = () =>
      true,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const poll = (): void => {
        const found = this.framesOf(type).find(match);
        if (found) return resolve(found);
        if (Date.now() > deadline) {
          return reject(
            new Error(
              `timed out waiting for a ${type} frame (${timeoutMs} ms)`,
            ),
          );
        }
        setTimeout(poll, 5);
      };
      poll();
    });
  }

  /** Closes the socket; resolves when the socket is closed. */
  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) =>
      this.ws.once('close', () => resolve()),
    );
    if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
    else this.ws.close();
    await closed;
  }

  private onMessage(raw: string): void {
    const message = JSON.parse(raw) as ServerMessage;
    this.received.push(message);
    if (this.autoAck && needsAck(message)) this.ack(message.id);
  }

  private write(input: {
    type: DeviceMessage['type'];
    payload: unknown;
    ref: string | null;
    id?: string;
  }): void {
    this.ws.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: input.id ?? randomUUID(),
        type: input.type,
        ts: Math.floor(Date.now() / 1000),
        ref: input.ref,
        payload: input.payload,
      }),
    );
  }
}

/** `ack` and `hello.ok` are answers, not orders that must be confirmed. */
function needsAck(message: ServerMessage): boolean {
  return message.type !== 'ack' && message.type !== 'hello.ok';
}

function rawToString(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
