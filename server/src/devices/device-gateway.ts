import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { ServerMessage } from '@gymtime/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import {
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
const CLOSE_SHUTDOWN = 1001;

/** Thin transport layer: turns frames into processor calls and back. */
@Injectable()
export class DeviceGateway
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DeviceGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true });
  private httpServer?: Server;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly processor: MessageProcessor,
    private readonly devices: DevicesService,
    private readonly registry: ConnectionRegistry,
    private readonly sender: OutboundSender,
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
    // No connection survives a restart, so nothing can still be online.
    await this.devices.markAllOffline();
    this.httpServer =
      this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
    this.httpServer.on('upgrade', this.onUpgrade);
  }

  onApplicationShutdown(): void {
    this.httpServer?.off('upgrade', this.onUpgrade);
    for (const client of this.wss.clients) client.close(CLOSE_SHUTDOWN);
    this.wss.close();
  }

  private onConnection(ws: WebSocket): void {
    const session: Session = { deviceId: null };
    const connection = this.createConnection(ws, session);
    this.logger.log({ event: 'connection_opened' });

    const helloTimer = setTimeout(() => {
      if (session.deviceId) return;
      this.logger.warn({ event: 'hello_timeout' });
      connection.close(CLOSE_HELLO_TIMEOUT, 'hello timeout');
    }, this.config.helloTimeoutMs);

    // Frames of one connection are processed strictly in order.
    let queue: Promise<void> = Promise.resolve();
    ws.on('message', (data, isBinary) => {
      const raw = isBinary ? '' : (data as Buffer).toString();
      queue = queue.then(() => this.handleFrame(session, connection, raw));
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      queue = queue.then(() => this.handleClose(session, connection));
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
        break;
      }
    }
  }

  private async handleClose(
    session: Session,
    connection: DeviceConnection,
  ): Promise<void> {
    const { deviceId } = session;
    this.logger.log({ event: 'closed', deviceId });
    if (!deviceId || !this.registry.unregister(deviceId, connection)) return;
    this.sender.failPending(deviceId);
    try {
      await this.devices.markOffline(deviceId);
    } catch (error) {
      this.logger.error({
        event: 'mark_offline_failed',
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
