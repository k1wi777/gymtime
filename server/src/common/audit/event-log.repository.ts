import type { Actor } from './actor.js';

export interface EventLogEntry {
  type: string;
  actor: Actor;
  detail: Record<string, unknown> | null;
}

/** A stored audit row. */
export interface StoredEvent extends EventLogEntry {
  id: number;
  createdAt: Date;
}

export interface EventLogQuery {
  /** Event types starting with this text (`student.` = every student event). */
  typePrefix?: string;
  /** Exactly one of these types. */
  types?: string[];
  actorId?: string;
  /** The detail has `key` equal to one of `values` (e.g. `sessionId`). */
  detailMatch?: { key: string; values: string[] };
  /** Inclusive bounds of the event date. */
  from?: Date;
  to?: Date;
  /** Only events older than this id (cursor of the previous page). */
  before?: number;
  limit: number;
}

export interface EventLogRepository {
  append(entry: EventLogEntry): Promise<void>;
  /** Newest first (by id). */
  search(query: EventLogQuery): Promise<StoredEvent[]>;
  /**
   * Removes `keys` from the detail of every event whose `studentId` is the
   * given one (erasure, Ley 1581). Returns how many rows changed.
   */
  redactStudent(studentId: string, keys: readonly string[]): Promise<number>;
}

export const EVENT_LOG_REPOSITORY = Symbol('EVENT_LOG_REPOSITORY');
