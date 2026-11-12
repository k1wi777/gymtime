import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OFFLINE_BATCH_MAX,
  OFFLINE_QUEUE_MAX,
  PROTOCOL_VERSION,
  generateDisplayName,
  ROSTER_NAME_MAX,
  toAscii,
  type ServerMessage,
} from '@gymtime/shared';
import { AttendanceService } from '../attendance/attendance.service.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { DevicesService } from '../devices/devices.service.js';
import { OutboundSender } from '../devices/outbound-sender.service.js';
import { StudentsService } from '../students/students.service.js';
import type { SyncedEvent } from '../sync/sync.service.js';
import {
  OFFLINE_SNAPSHOTS_REPOSITORY,
  type OfflineSnapshotsRepository,
} from './domain/offline-snapshots.repository.js';
import { OFFLINE_CONFIG, type OfflineConfig } from './offline.config.js';

const MS_PER_DAY = 86_400_000;

/**
 * Builds and sends the `offline.snapshot` (E26-3): the schedule, the roster and
 * who is inside, taken from the very sync that just loaded the reader so the
 * two messages never disagree. A reader that declared no `offline` capability
 * never gets one (R1). If the reader reconnects with events still queued, the
 * snapshot waits for the last batch (or a timeout) so `open`/`exited` already
 * include them.
 */
@Injectable()
export class OfflineSnapshotService {
  private readonly logger = new Logger(OfflineSnapshotService.name);
  /** Last finished sync of each device whose snapshot is still to send. */
  private readonly pending = new Map<string, SyncedEvent>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Connection (hello instant) whose queue already arrived, per device. */
  private readonly drained = new Map<string, number>();

  constructor(
    @Inject(OFFLINE_SNAPSHOTS_REPOSITORY)
    private readonly snapshots: OfflineSnapshotsRepository,
    private readonly devices: DevicesService,
    private readonly sender: OutboundSender,
    private readonly attendance: AttendanceService,
    private readonly students: StudentsService,
    @Inject(OFFLINE_CONFIG) private readonly config: OfflineConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** A sync finished: send the snapshot now, or after the queue arrives. */
  async onSynced(event: SyncedEvent): Promise<void> {
    const hello = this.devices.helloInfo(event.deviceId);
    if (!hello?.capabilities.includes('offline')) return;
    this.pending.set(event.deviceId, event);
    const waiting =
      hello.queued > 0 &&
      this.drained.get(event.deviceId) !== hello.at.getTime();
    if (!waiting) {
      await this.deliver(event.deviceId);
      return;
    }
    this.clearTimer(event.deviceId);
    const timer = setTimeout(
      () => void this.deliver(event.deviceId),
      this.config.snapshotWaitSec * 1000,
    );
    timer.unref();
    this.timers.set(event.deviceId, timer);
  }

  /** A batch was reconciled; the last one releases a waiting snapshot. */
  async onBatchProcessed(deviceId: string, last: boolean): Promise<void> {
    if (!last) return;
    const hello = this.devices.helloInfo(deviceId);
    if (hello) this.drained.set(deviceId, hello.at.getTime());
    if (this.timers.has(deviceId)) await this.deliver(deviceId);
  }

  /** Stops every pending wait (server shutdown). */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  private clearTimer(deviceId: string): void {
    const timer = this.timers.get(deviceId);
    if (timer) clearTimeout(timer);
    this.timers.delete(deviceId);
  }

  /** Never throws: a snapshot that fails is rebuilt by the next sync. */
  private async deliver(deviceId: string): Promise<void> {
    this.clearTimer(deviceId);
    const synced = this.pending.get(deviceId);
    this.pending.delete(deviceId);
    if (!synced) return;
    try {
      const message = await this.build(synced);
      const result = await this.sender.send(deviceId, message);
      this.logger.log({
        event: 'offline_snapshot_sent',
        deviceId,
        snapshotId: message.payload.snapshotId,
        slots: message.payload.roster.length,
        result,
      });
    } catch (error) {
      this.logger.error({
        event: 'offline_snapshot_failed',
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async build(
    synced: SyncedEvent,
  ): Promise<Extract<ServerMessage, { type: 'offline.snapshot' }>> {
    const now = this.clock.now();
    const students = await this.students.findByIds(
      synced.slots.map((s) => s.studentId),
    );
    const nameOf = new Map(
      students.map((s) => [
        s.id,
        generateDisplayName(toAscii(s.displayName || s.name), ROSTER_NAME_MAX),
      ]),
    );
    const open = new Set(await this.attendance.listOpenStudentIds());
    const exited = new Set(
      synced.schedule
        ? await this.attendance.listClosedStudentIdsByInstance(
            synced.schedule.instanceId,
          )
        : [],
    );
    const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
    const snapshotId = randomUUID();
    // Ids, never names, are what stays in the database.
    await this.snapshots.save({
      id: snapshotId,
      deviceId: synced.deviceId,
      scheduleId: synced.schedule?.scheduleId ?? null,
      roster: Object.fromEntries(
        synced.slots.map((s) => [s.slot, s.studentId]),
      ),
      createdAt: now,
    });
    await this.snapshots.purgeOlderThan(
      new Date(now.getTime() - this.config.retentionDays * MS_PER_DAY),
    );
    const slotsWhere = (included: Set<string>) =>
      synced.slots.filter((s) => included.has(s.studentId)).map((s) => s.slot);
    return {
      v: PROTOCOL_VERSION,
      id: randomUUID(),
      type: 'offline.snapshot',
      ts: seconds(now),
      ref: null,
      payload: {
        snapshotId,
        generatedAt: seconds(now),
        schedule: synced.schedule && {
          scheduleId: synced.schedule.scheduleId,
          start: seconds(synced.schedule.startsAt),
          end: seconds(synced.schedule.endsAt),
          entryOpensAt: seconds(synced.schedule.entryOpensAt),
          entryClosesAt: seconds(synced.schedule.entryClosesAt),
        },
        roster: synced.slots
          .filter((s) => nameOf.has(s.studentId))
          .map((s) => ({ slot: s.slot, name: nameOf.get(s.studentId)! })),
        open: slotsWhere(open),
        exited: slotsWhere(exited),
        limits: { queueMax: OFFLINE_QUEUE_MAX, batchMax: OFFLINE_BATCH_MAX },
      },
    };
  }
}
