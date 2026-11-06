import { Inject, Injectable, Logger } from '@nestjs/common';
import { currentActor } from './actor.js';
import {
  EVENT_LOG_REPOSITORY,
  type EventLogRepository,
} from './event-log.repository.js';

/** Keys that must never reach the audit trail (biometrics, secrets). */
const FORBIDDEN_KEYS =
  /^iv$|template|plantilla|token|secret|password|api.?key|encryption/i;

/**
 * Writes the audit trail (`event_log`). The actor comes from the request or
 * message context. A failing write is logged and never fails the operation.
 */
@Injectable()
export class EventLogService {
  private readonly logger = new Logger(EventLogService.name);

  constructor(
    @Inject(EVENT_LOG_REPOSITORY)
    private readonly repository: EventLogRepository,
  ) {}

  async record(type: string, detail?: Record<string, unknown>): Promise<void> {
    try {
      await this.repository.append({
        type,
        actor: currentActor(),
        detail: detail ? sanitize(detail) : null,
      });
    } catch (error) {
      this.logger.error({
        event: 'event_log_failed',
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function sanitize(detail: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(detail).filter(([key]) => !FORBIDDEN_KEYS.test(key)),
  );
}
