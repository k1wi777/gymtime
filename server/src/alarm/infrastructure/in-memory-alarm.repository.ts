import { randomUUID } from 'node:crypto';
import type {
  AlarmEvent,
  CloseAlarmEvent,
  NewAlarmEvent,
  NewLocalAlarmEvent,
} from '../domain/alarm-event.js';
import type {
  AlarmHistoryFilter,
  AlarmRepository,
} from '../domain/alarm.repository.js';

export class InMemoryAlarmRepository implements AlarmRepository {
  private readonly rows = new Map<string, AlarmEvent>();

  async create(data: NewAlarmEvent): Promise<AlarmEvent> {
    const event: AlarmEvent = {
      id: randomUUID(),
      instanceId: data.instanceId,
      startedAt: data.startedAt,
      endedAt: null,
      closedBy: null,
      closedSessions: 0,
      origin: 'server',
      deviceId: null,
      deviceEventId: null,
    };
    this.rows.set(event.id, event);
    return { ...event };
  }

  async createLocal(data: NewLocalAlarmEvent) {
    const existing = [...this.rows.values()].find(
      (row) =>
        row.deviceId === data.deviceId &&
        row.deviceEventId === data.deviceEventId,
    );
    if (existing) return { event: { ...existing }, created: false };
    const event: AlarmEvent = {
      id: randomUUID(),
      ...data,
      closedSessions: 0,
      origin: 'local',
    };
    this.rows.set(event.id, event);
    return { event: { ...event }, created: true };
  }

  async findOpen(): Promise<AlarmEvent[]> {
    return [...this.rows.values()]
      .filter((event) => event.endedAt === null && event.origin === 'server')
      .sort(
        (a, b) =>
          a.startedAt.getTime() - b.startedAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((event) => ({ ...event }));
  }

  async findOpenByInstance(instanceId: string): Promise<AlarmEvent | null> {
    const event = [...this.rows.values()].find(
      (row) =>
        row.instanceId === instanceId &&
        row.endedAt === null &&
        row.origin === 'server',
    );
    return event ? { ...event } : null;
  }

  async instanceIdsWithEvents(instanceIds: string[]) {
    const wanted = new Set(instanceIds);
    return [
      ...new Set(
        [...this.rows.values()]
          .filter((row) => wanted.has(row.instanceId))
          .map((row) => row.instanceId),
      ),
    ];
  }

  async findByInstanceIds(instanceIds: string[]) {
    const wanted = new Set(instanceIds);
    return [...this.rows.values()]
      .filter((row) => wanted.has(row.instanceId))
      .sort(
        (a, b) =>
          a.startedAt.getTime() - b.startedAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((row) => ({ ...row }));
  }

  /** Loads events as they are (data loaders and tests). */
  load(events: AlarmEvent[]): void {
    for (const event of events) this.rows.set(event.id, { ...event });
  }

  async list(filter: AlarmHistoryFilter) {
    const matching = [...this.rows.values()]
      .filter(
        (row) =>
          (!filter.from || row.startedAt >= filter.from) &&
          (!filter.to || row.startedAt <= filter.to),
      )
      .sort(
        (a, b) =>
          b.startedAt.getTime() - a.startedAt.getTime() ||
          b.id.localeCompare(a.id),
      );
    return {
      items: matching
        .slice(filter.offset, filter.offset + filter.limit)
        .map((row) => ({ ...row })),
      total: matching.length,
    };
  }

  async close(id: string, data: CloseAlarmEvent): Promise<AlarmEvent | null> {
    const current = this.rows.get(id);
    if (!current || current.endedAt !== null) return null;
    const closed: AlarmEvent = { ...current, ...data };
    this.rows.set(id, closed);
    return { ...closed };
  }
}
