import { Inject, Injectable, Logger } from '@nestjs/common';
import { currentActor } from './actor.js';
import {
  EVENT_LOG_REPOSITORY,
  type EventLogQuery,
  type EventLogRepository,
  type StoredEvent,
} from './event-log.repository.js';

/**
 * Keys that must never reach the audit trail (biometrics, secrets, account
 * credentials). `session` alone is dropped, but not `sessionsClosed`.
 */
const FORBIDDEN_KEYS =
  /^iv$|^session$|template|plantilla|token|secret|password|hash|cookie|authorization|api.?key|encryption/i;

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

  /** Reads the trail, newest first; the detail is cleaned once more on the way out. */
  async search(query: EventLogQuery): Promise<StoredEvent[]> {
    return (await this.repository.search(query)).map((event) => ({
      ...event,
      detail: event.detail ? sanitize(event.detail, true) : null,
    }));
  }

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

/** Contact data is never shown in the audit trail, even if an old row had it. */
const CONTACT_KEYS = /email|phone|correo|telefono/i;

function sanitize(
  detail: Record<string, unknown>,
  alsoContact = false,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(detail).filter(
      ([key]) =>
        !FORBIDDEN_KEYS.test(key) && !(alsoContact && CONTACT_KEYS.test(key)),
    ),
  );
}
