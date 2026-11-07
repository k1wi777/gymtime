import { Inject, Injectable, Logger } from '@nestjs/common';
import { FingerprintsService } from '../fingerprints/fingerprints.service.js';
import {
  InstancesService,
  type RelevantOccurrence,
} from '../schedules/instances.service.js';
import type {
  PlannedSchedule,
  PlannedSlot,
  SyncPlan,
} from './domain/sync-plan.js';
import type { OpenSessionsProvider } from './domain/open-sessions.provider.js';
import { SYNC_CONFIG, type SyncConfig } from './sync.config.js';

/** Builds what the reader should hold at a given instant. */
@Injectable()
export class SyncPlanner {
  private readonly logger = new Logger(SyncPlanner.name);

  constructor(
    private readonly instances: InstancesService,
    private readonly fingerprints: FingerprintsService,
    @Inject(SYNC_CONFIG) private readonly config: SyncConfig,
  ) {}

  async build(
    now: Date,
    openSessions: OpenSessionsProvider,
  ): Promise<SyncPlan> {
    const relevant = await this.instances.listRelevant(
      now,
      this.config.leadMinutes,
    );
    // Open sessions first: they win when the reader runs out of slots.
    const ids = unique([
      ...(await openSessions.listStudentIds()),
      ...relevant.flatMap((o) => o.studentIds),
    ]);
    const { fingerprints, skippedStudentIds } =
      await this.fingerprints.findSyncable(ids);
    const capacity = this.fingerprints.syncSlotCapacity;
    const kept = fingerprints.slice(0, capacity);
    const omitted = fingerprints.length - kept.length;

    if (skippedStudentIds.length > 0) {
      this.logger.warn({
        event: 'sync_students_skipped',
        count: skippedStudentIds.length,
        studentIds: skippedStudentIds,
      });
    }
    if (omitted > 0) {
      this.logger.warn({ event: 'sync_over_capacity', capacity, omitted });
    }

    const slots: PlannedSlot[] = kept.map((f, i) => ({
      slot: i + 1,
      fingerprintId: f.fingerprintId,
      studentId: f.studentId,
    }));
    return {
      slots,
      templates: kept.map((f) => f.template),
      omitted,
      skippedStudentIds,
      schedule: pickSchedule(relevant, now),
    };
  }
}

const unique = <T>(items: T[]): T[] => [...new Set(items)];

/** The occurrence in progress or, failing that, the one starting soonest. */
function pickSchedule(
  relevant: RelevantOccurrence[],
  now: Date,
): PlannedSchedule | null {
  const chosen =
    relevant.find((o) => o.instance.startsAt <= now) ?? relevant[0];
  if (!chosen) return null;
  return {
    scheduleId: chosen.schedule.id,
    instanceId: chosen.instance.id,
    startsAt: chosen.instance.startsAt,
    endsAt: chosen.instance.endsAt,
    entryOpensAt: chosen.window.opensAt,
    entryClosesAt: chosen.window.closesAt,
  };
}
