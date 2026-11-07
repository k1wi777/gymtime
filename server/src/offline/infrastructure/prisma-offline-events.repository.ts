import { Injectable } from '@nestjs/common';
import type { OfflineReviewReason } from '@gymtime/shared';
import { PrismaService } from '../../database/prisma.service.js';
import {
  APPLIED_OUTCOMES,
  type NewOfflineEvent,
  type OfflineEventFilter,
  type OfflineEventRecord,
  type OfflineEventType,
  type OfflineOutcome,
  type OfflineResolution,
  type OfflineResolutionData,
  type OfflineSettlement,
} from '../domain/offline-event.js';
import type { OfflineEventsRepository } from '../domain/offline-events.repository.js';

interface Row {
  deviceId: string;
  id: string;
  seq: number;
  ts: Date;
  type: string;
  slot: number | null;
  snapshotId: string | null;
  batchId: string | null;
  studentId: string | null;
  instanceId: string | null;
  outcome: string;
  reviewReason: string | null;
  sessionId: string | null;
  alarmEventId: string | null;
  receivedAt: Date;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolution: string | null;
  resolutionNote: string | null;
  correctedTs: Date | null;
}

const toDomain = (row: Row): OfflineEventRecord => ({
  ...row,
  type: row.type as OfflineEventType,
  outcome: row.outcome as OfflineOutcome,
  reviewReason: row.reviewReason as OfflineReviewReason | null,
  resolution: row.resolution as OfflineResolution | null,
});

function where(filter: OfflineEventFilter) {
  return {
    ...(filter.id && { id: filter.id }),
    ...(filter.outcomes && { outcome: { in: filter.outcomes } }),
    ...(filter.studentId && { studentId: filter.studentId }),
    ...((filter.from || filter.to) && {
      ts: { gte: filter.from, lte: filter.to },
    }),
  };
}

@Injectable()
export class PrismaOfflineEventsRepository implements OfflineEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insertIfAbsent(events: NewOfflineEvent[]) {
    if (events.length === 0) return [];
    // The primary key arbitrates: one insert per event tells exactly which
    // ones this call created, even with two batches racing.
    const fresh = new Set<string>();
    for (const event of events) {
      const { count } = await this.prisma.offlineEvent.createMany({
        data: [{ ...event, outcome: 'pendiente' }],
        skipDuplicates: true,
      });
      if (count > 0) fresh.add(`${event.deviceId}/${event.id}`);
    }
    const stored = await this.prisma.offlineEvent.findMany({
      where: {
        OR: events.map((e) => ({ deviceId: e.deviceId, id: e.id })),
      },
    });
    const byKey = new Map(stored.map((r) => [`${r.deviceId}/${r.id}`, r]));
    return events.map((event) => {
      const key = `${event.deviceId}/${event.id}`;
      const row = byKey.get(key);
      if (!row) throw new Error('offline event vanished after insert');
      return { record: toDomain(row), isNew: fresh.has(key) };
    });
  }

  async settle(deviceId: string, id: string, data: OfflineSettlement) {
    const { count } = await this.prisma.offlineEvent.updateMany({
      where: { deviceId, id, outcome: 'pendiente' },
      data: {
        outcome: data.outcome,
        reviewReason: data.reviewReason ?? null,
        studentId: data.studentId ?? null,
        instanceId: data.instanceId ?? null,
        sessionId: data.sessionId ?? null,
        alarmEventId: data.alarmEventId ?? null,
      },
    });
    return count === 0 ? null : this.findById(deviceId, id);
  }

  async findById(deviceId: string, id: string) {
    const row = await this.prisma.offlineEvent.findUnique({
      where: { deviceId_id: { deviceId, id } },
    });
    return row ? toDomain(row) : null;
  }

  async lastAppliedTs(studentId: string) {
    const rows = await this.prisma.offlineEvent.findMany({
      where: {
        studentId,
        outcome: { in: [...APPLIED_OUTCOMES] },
        type: { in: ['entry', 'exit'] },
      },
      select: { ts: true, correctedTs: true },
    });
    let latest: Date | null = null;
    for (const row of rows) {
      const at = row.correctedTs ?? row.ts;
      if (!latest || at > latest) latest = at;
    }
    return latest;
  }

  async list(filter: OfflineEventFilter = {}) {
    const [rows, total] = await Promise.all([
      this.prisma.offlineEvent.findMany({
        where: where(filter),
        orderBy: [{ ts: 'asc' }, { seq: 'asc' }, { id: 'asc' }],
        ...(filter.offset && { skip: filter.offset }),
        ...(filter.limit && { take: filter.limit }),
      }),
      this.prisma.offlineEvent.count({ where: where(filter) }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async countByOutcome(window: { from?: Date; to?: Date }) {
    const groups = await this.prisma.offlineEvent.groupBy({
      by: ['outcome'],
      where: where(window),
      _count: { _all: true },
    });
    const counts: Partial<Record<OfflineOutcome, number>> = {};
    for (const group of groups) {
      counts[group.outcome as OfflineOutcome] = group._count._all;
    }
    return counts;
  }

  async resolve(deviceId: string, id: string, data: OfflineResolutionData) {
    const { count } = await this.prisma.offlineEvent.updateMany({
      where: { deviceId, id, outcome: 'por_revisar' },
      data: {
        outcome: data.outcome,
        resolution: data.resolution,
        resolvedBy: data.resolvedBy,
        resolvedAt: data.resolvedAt,
        resolutionNote: data.resolutionNote,
        correctedTs: data.correctedTs ?? null,
        ...(data.sessionId && { sessionId: data.sessionId }),
        ...(data.studentId && { studentId: data.studentId }),
        ...(data.instanceId && { instanceId: data.instanceId }),
      },
    });
    return count === 0 ? null : this.findById(deviceId, id);
  }
}
