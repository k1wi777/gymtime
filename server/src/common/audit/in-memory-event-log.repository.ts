import type {
  EventLogEntry,
  EventLogQuery,
  EventLogRepository,
  StoredEvent,
} from './event-log.repository.js';

export class InMemoryEventLogRepository implements EventLogRepository {
  readonly entries: EventLogEntry[] = [];
  /** The same events with the id and date a database would add. */
  readonly stored: StoredEvent[] = [];

  async append(entry: EventLogEntry): Promise<void> {
    this.entries.push(entry);
    this.stored.push({
      ...entry,
      id: this.stored.length + 1,
      createdAt: new Date(),
    });
  }

  async search(query: EventLogQuery): Promise<StoredEvent[]> {
    return this.stored
      .filter(
        (event) =>
          (!query.typePrefix || event.type.startsWith(query.typePrefix)) &&
          (!query.types || query.types.includes(event.type)) &&
          (!query.actorId || event.actor.id === query.actorId) &&
          (!query.detailMatch ||
            query.detailMatch.values.includes(
              String(event.detail?.[query.detailMatch.key]),
            )) &&
          (!query.from || event.createdAt >= query.from) &&
          (!query.to || event.createdAt <= query.to) &&
          (query.before === undefined || event.id < query.before),
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, query.limit);
  }
}
