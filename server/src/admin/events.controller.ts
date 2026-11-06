import { Controller, Get, Logger, Req, Res } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  getSchemaPath,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Subscription } from 'rxjs';
import { AuthService } from '../auth/auth.service.js';
import { Auth, type AuthContext } from '../common/auth/auth-context.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { formatSseEvent } from './sse.js';
import { SSE_EVENT_DTOS } from '../openapi/sse-events.dto.js';
import { ApiAuth } from '../common/auth/roles.decorator.js';

export const SSE_KEEPALIVE_MS = 15_000;
/** A client that stops reading is dropped instead of buffering forever. */
export const SSE_MAX_BUFFERED_BYTES = 256 * 1024;

/**
 * Live system events for the CLI (`gym watch`) and the panel. Written straight
 * to the response instead of `@Sse` so a slow client can be detected and
 * dropped.
 *
 * A stream opened with a session cookie re-checks the session on every
 * heartbeat and ends when it is no longer valid (signed out, expired,
 * account deactivated). The stream itself does NOT renew the idle timer: an
 * abandoned screen must still expire; the panel keeps the session alive with
 * the user's activity (`GET /auth/me`).
 */
const EVENT_MODELS = Object.values(SSE_EVENT_DTOS);

@ApiTags('events')
@ApiAuth()
@ApiExtraModels(...EVENT_MODELS)
@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    private readonly events: SystemEventsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Live system events (Server-Sent Events)' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'Server-Sent Events. Each frame is `event: <type>` and `data: <JSON>` where the JSON is the schema below (type, at, data); a keepalive arrives every 15 s.',
    content: {
      'text/event-stream': {
        schema: {
          oneOf: EVENT_MODELS.map((model) => ({
            $ref: getSchemaPath(model),
          })),
          discriminator: {
            propertyName: 'type',
            mapping: Object.fromEntries(
              Object.entries(SSE_EVENT_DTOS).map(([type, model]) => [
                type,
                getSchemaPath(model),
              ]),
            ),
          },
        },
      },
    },
  })
  stream(
    @Req() req: Request,
    @Res() res: Response,
    @Auth() caller?: AuthContext,
  ): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    let subscription: Subscription | undefined;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      subscription?.unsubscribe();
      if (!res.writableEnded) res.end();
    };
    const dropSlowClient = (): void => {
      this.logger.warn({ event: 'sse_client_dropped' });
      cleanup();
    };

    const heartbeat = (): void => {
      if (closed) return;
      if (res.writableLength > SSE_MAX_BUFFERED_BYTES) {
        dropSlowClient();
        return;
      }
      res.write(
        formatSseEvent({
          type: 'keepalive',
          at: new Date().toISOString(),
          data: {},
        }),
      );
    };
    const tick = async (): Promise<void> => {
      if (caller?.kind === 'session') {
        const active = await this.auth.isSessionActive(caller.sessionId);
        if (!active) {
          this.logger.log({ event: 'sse_session_ended' });
          cleanup();
          return;
        }
      }
      heartbeat();
    };
    const keepalive = setInterval(() => {
      // The system credential never expires: keep its heartbeat synchronous.
      if (caller?.kind === 'session') void tick();
      else heartbeat();
    }, SSE_KEEPALIVE_MS);

    subscription = this.events.events.subscribe((event) => {
      if (closed) return;
      const flushed = res.write(formatSseEvent(event));
      if (!flushed && res.writableLength > SSE_MAX_BUFFERED_BYTES) {
        dropSlowClient();
      }
    });

    req.on('close', cleanup);
  }
}
