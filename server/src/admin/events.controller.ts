import { Controller, Get, Logger, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Subscription } from 'rxjs';
import { API_KEY_HEADER, ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { formatSseEvent } from './sse.js';

export const SSE_KEEPALIVE_MS = 15_000;
/** A client that stops reading is dropped instead of buffering forever. */
export const SSE_MAX_BUFFERED_BYTES = 256 * 1024;

/**
 * Live system events for the CLI (`gym watch`). Written straight to the
 * response instead of `@Sse` so a slow client can be detected and dropped.
 */
@ApiTags('events')
@ApiHeader({ name: API_KEY_HEADER, required: true })
@UseGuards(ApiKeyGuard)
@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly events: SystemEventsService) {}

  @Get()
  @ApiOperation({ summary: 'Live system events (Server-Sent Events)' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'Stream of SystemEvent frames' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key' })
  stream(@Req() req: Request, @Res() res: Response): void {
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

    const keepalive = setInterval(() => {
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
