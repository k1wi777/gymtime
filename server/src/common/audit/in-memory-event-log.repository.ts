import type {
  EventLogEntry,
  EventLogRepository,
} from './event-log.repository.js';

export class InMemoryEventLogRepository implements EventLogRepository {
  readonly entries: EventLogEntry[] = [];

  async append(entry: EventLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}
