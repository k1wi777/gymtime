import type { OfflineReviewReason } from '@gymtime/shared';
import {
  APPLIED_OUTCOMES,
  type NewOfflineEvent,
  type OfflineEventFilter,
  type OfflineEventRecord,
  type OfflineOutcome,
  type OfflineResolutionData,
  type OfflineSettlement,
} from '../domain/offline-event.js';
import type { OfflineEventsRepository } from '../domain/offline-events.repository.js';

const keyOf = (deviceId: string, id: string): string => `${deviceId}/${id}`;

export class InMemoryOfflineEventsRepository implements OfflineEventsRepository {
  private readonly rows = new Map<string, OfflineEventRecord>();

  async insertIfAbsent(events: NewOfflineEvent[]) {
    return events.map((event) => {
      const key = keyOf(event.deviceId, event.id);
      const existing = this.rows.get(key);
      if (existing) return { record: { ...existing }, isNew: false };
      const record: OfflineEventRecord = {
        ...event,
        studentId: null,
        instanceId: null,
        outcome: 'pendiente',
        reviewReason: null,
        sessionId: null,
        alarmEventId: null,
        resolvedBy: null,
        resolvedAt: null,
        resolution: null,
        resolutionNote: null,
        correctedTs: null,
      };
      this.rows.set(key, record);
      return { record: { ...record }, isNew: true };
    });
  }

  async settle(deviceId: string, id: string, data: OfflineSettlement) {
    const key = keyOf(deviceId, id);
    const current = this.rows.get(key);
    if (current?.outcome !== 'pendiente') return null;
    const settled: OfflineEventRecord = {
      ...current,
      outcome: data.outcome,
      reviewReason: (data.reviewReason ?? null) as OfflineReviewReason | null,
      studentId: data.studentId ?? null,
      instanceId: data.instanceId ?? null,
      sessionId: data.sessionId ?? null,
      alarmEventId: data.alarmEventId ?? null,
    };
    this.rows.set(key, settled);
    return { ...settled };
  }

  async findById(deviceId: string, id: string) {
    const row = this.rows.get(keyOf(deviceId, id));
    return row ? { ...row } : null;
  }

  async lastAppliedTs(studentId: string) {
    let latest: Date | null = null;
    for (const row of this.rows.values()) {
      if (row.studentId !== studentId) continue;
      if (!APPLIED_OUTCOMES.includes(row.outcome)) continue;
      if (row.type !== 'entry' && row.type !== 'exit') continue;
      const at = row.correctedTs ?? row.ts;
      if (!latest || at > latest) latest = at;
    }
    return latest;
  }

  async list(filter: OfflineEventFilter = {}) {
    const matching = [...this.rows.values()]
      .filter(
        (r) =>
          (!filter.id || r.id === filter.id) &&
          (!filter.outcomes || filter.outcomes.includes(r.outcome)) &&
          (!filter.studentId || r.studentId === filter.studentId) &&
          (!filter.from || r.ts >= filter.from) &&
          (!filter.to || r.ts <= filter.to),
      )
      .sort(
        (a, b) =>
          a.ts.getTime() - b.ts.getTime() ||
          a.seq - b.seq ||
          a.id.localeCompare(b.id),
      );
    const offset = filter.offset ?? 0;
    return {
      items: matching
        .slice(offset, filter.limit ? offset + filter.limit : undefined)
        .map((r) => ({ ...r })),
      total: matching.length,
    };
  }

  async countByOutcome(window: { from?: Date; to?: Date }) {
    const counts: Partial<Record<OfflineOutcome, number>> = {};
    for (const row of this.rows.values()) {
      if (window.from && row.ts < window.from) continue;
      if (window.to && row.ts > window.to) continue;
      counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
    }
    return counts;
  }

  async resolve(deviceId: string, id: string, data: OfflineResolutionData) {
    const key = keyOf(deviceId, id);
    const current = this.rows.get(key);
    if (current?.outcome !== 'por_revisar') return null;
    const resolved: OfflineEventRecord = {
      ...current,
      outcome: data.outcome,
      resolution: data.resolution,
      resolvedBy: data.resolvedBy,
      resolvedAt: data.resolvedAt,
      resolutionNote: data.resolutionNote,
      correctedTs: data.correctedTs ?? null,
      sessionId: data.sessionId ?? current.sessionId,
      studentId: data.studentId ?? current.studentId,
      instanceId: data.instanceId ?? current.instanceId,
    };
    this.rows.set(key, resolved);
    return { ...resolved };
  }
}
