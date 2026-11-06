import type { Actor } from './actor.js';

export interface EventLogEntry {
  type: string;
  actor: Actor;
  detail: Record<string, unknown> | null;
}

export interface EventLogRepository {
  append(entry: EventLogEntry): Promise<void>;
}

export const EVENT_LOG_REPOSITORY = Symbol('EVENT_LOG_REPOSITORY');
