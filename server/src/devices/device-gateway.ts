import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FRAME_MAX_BYTES, type ServerMessage } from '@gymtime/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { SystemEventsService } from '../common/events/system-events.service.js';
import {
  CLOSE_TOKEN_CHANGED,
  ConnectionRegistry,
  type DeviceConnection,
} from './connection-registry.js';
import { DEVICES_CONFIG, type DevicesConfig } from './devices.config.js';
import { DevicesService } from './devices.service.js';
import {
  MessageProcessor,
  type Action,
  type Session,
} from './message-processor.service.js';
import { OutboundSender } from './outbound-sender.service.js';

export const DEVICE_PATH = '/device';
const CLOSE_HELLO_TIMEOUT = 4408;
const CLOSE_REPLACED = 4409;
const CLOSE_HEARTBEAT = 4402;
const CLOSE_SHUTDOWN = 1001;
/** How long a reader has to answer the close before it is terminated. */
const SHUTDOWN_GRACE_MS = 1000;

type DisconnectReason =
  | 'closed'
  | 'replaced'
  | 'heartbeat_timeout'
  | 'server_shutdown'
  | 'token_revoked';

/** Thin transport layer: turns frames into processor calls and back. */
@Injectable()
export class DeviceGateway
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(DeviceGateway.name);
  private readonly wss = new WebSocketServer({
    noServer: true,
    // A frame above this closes the connection (code 1009): the largest
    // legitimate message (a batch of 50 events) is about 10 KB.
    maxPayload: FRAME_MAX_BYTES,
  });
  private httpServer?: Server;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly processor: MessageProcessor,
    private readonly devices: DevicesService,
    private readonly registry: ConnectionRegistry,
    private readonly sender: OutboundSender,
    private readonly events: SystemEventsService,
    @Inject(DEVICES_CONFIG) private readonly config: DevicesConfig,
  ) {}

  private readonly onUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== DEVICE_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) =>
      this.onConnection(ws),
    );
  };

  async onApplicationBootstrap(): Promise<void> {
    // No connection survives a restart, so nothing can still be online and
    // whatever stayed `sent` was never confirmed.
    await this.devices.markAllOffline();
    const reset = await this.sender.resetSentToPending();
    if (reset > 0) this.logger.warn({ event: 'commands_reset_pending', reset });
    this.httpServer =
      this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
    this.httpServer.on('upgrade', this.onUpgrade);
  }

  /**
   * Runs BEFORE Nest closes the HTTP server, which does not finish while a
   * WebSocket is open: closing the readers afterwards would wait forever (or
   * until Docker kills the process). A reader that does not answer the close
   * handshake within a second is terminated.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.httpServer?.off('upgrade', this.onUpgrade);
    const open = [...this.wss.clients];
    const closed = Promise.all(
      open.map(
        (client) =>
          new Promise<void>((resolve) => client.once('close', () => resolve())),
      ),
    );
    for (const client of open) client.close(CLOSE_SHUTDOWN);
    let timer: NodeJS.Timeout | undefined;
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_GRACE_MS);
    });
    await Promise.race([closed, grace]);
    clearTimeout(timer);
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private onConnection(ws: WebSocket): void {
    const session: Session = { deviceId: null };
    const connection = this.createConnection(ws, session);
    this.logger.log({ event: 'connection_opened' });

    let heartbeatTimer: NodeJS.Timeout | undefined;
    let closed = false;
    const clearHeartbeat = (): void => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = undefined;
    };
    // Authenticated connections must keep talking: two heartbeat intervals
    // without a frame mean the link is dead even if TCP does not know yet.
    const armHeartbeat = (): void => {
      clearHeartbeat();
      if (closed || !session.deviceId) return;
      heartbeatTimer = setTimeout(() => {
        this.logger.warn({
          event: 'heartbeat_timeout',
          deviceId: session.deviceId,
        });
        connection.close(CLOSE_HEARTBEAT, 'heartbeat timeout');
      }, this.config.heartbeatTimeoutMs);
    };

    const helloTimer = setTimeout(() => {
      if (session.deviceId) return;
      this.logger.warn({ event: 'hello_timeout' });
      connection.close(CLOSE_HELLO_TIMEOUT, 'hello timeout');
    }, this.config.helloTimeoutMs);

    // Frames of one connection are processed strictly in order.
    let queue: Promise<void> = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      const raw = isBinary ? '' : (data as Buffer).toString();
      queue = queue
        .then(() => this.handleFrame(session, connection, raw))
        .then(() => armHeartbeat());
    });
    ws.on('close', (code) => {
      closed = true;
      clearHeartbeat();
      clearTimeout(helloTimer);
      queue = queue.then(() => this.handleClose(session, connection, code));
    });
    ws.on('error', (error) =>
      this.logger.warn({ event: 'socket_error', error: error.message }),
    );
  }

  private createConnection(ws: WebSocket, session: Session): DeviceConnection {
    return {
      send: (message: ServerMessage) => {
        if (ws.readyState !== ws.OPEN) return;
        this.logger.log({
          event: 'message_sent',
          deviceId: session.deviceId,
          type: message.type,
          id: message.id,
          ref: message.ref,
        });
        ws.send(JSON.stringify(message));
      },
      close: (code, reason) => ws.close(code, reason),
    };
  }

  private async handleFrame(
    session: Session,
    connection: DeviceConnection,
    raw: string,
  ): Promise<void> {
    try {
      const actions = await this.processor.process(session, raw);
      for (const action of actions) this.execute(action, session, connection);
      // After the loop: hello.ok is already out and the connection registered.
      if (actions.some((a) => a.kind === 'authenticated') && session.deviceId) {
        void this.devices.notifyConnected(session.deviceId);
      }
    } catch (error) {
      this.logger.error({
        event: 'frame_failed',
        deviceId: session.deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private execute(
    action: Action,
    session: Session,
    connection: DeviceConnection,
  ): void {
    switch (action.kind) {
      case 'send':
        connection.send(action.message);
        break;
      case 'close':
        connection.close(action.code, action.reason);
        break;
      case 'authenticated': {
        session.deviceId = action.deviceId;
        const previous = this.registry.register(action.deviceId, connection);
        if (previous) {
          this.logger.log({ event: 'replaced', deviceId: action.deviceId });
          previous.close(CLOSE_REPLACED, 'replaced by a new connection');
        }
        this.events.emit('device.connected', {
          deviceId: action.deviceId,
          firmwareVersion: action.firmwareVersion,
        });
        // Replays the queue without delaying hello.ok or the sync.
        void this.sender.replayPending(action.deviceId);
        break;
      }
    }
  }

  private async handleClose(
    session: Session,
    connection: DeviceConnection,
    code: number,
  ): Promise<void> {
    const { deviceId } = session;
    this.logger.log({ event: 'closed', deviceId, code });
    if (!deviceId || !this.registry.unregister(deviceId, connection)) return;
    await this.sender.handleDisconnect(deviceId);
    try {
      await this.devices.markOffline(deviceId);
    } catch (error) {
      this.logger.error({
        event: 'mark_offline_failed',
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.events.emit('device.disconnected', {
      deviceId,
      reason: disconnectReason(code),
    });
  }
}

function disconnectReason(code: number): DisconnectReason {
  if (code === CLOSE_HEARTBEAT) return 'heartbeat_timeout';
  if (code === CLOSE_REPLACED) return 'replaced';
  if (code === CLOSE_SHUTDOWN) return 'server_shutdown';
  if (code === CLOSE_TOKEN_CHANGED) return 'token_revoked';
  return 'closed';
}
