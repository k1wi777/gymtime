import { randomUUID } from 'node:crypto';
import { buildAlarmFixture, bogota } from '../alarm/testing.js';
import { defaultOfflineConfig, type OfflineConfig } from './offline.config.js';
import { InMemoryOfflineEventsRepository } from './infrastructure/in-memory-offline-events.repository.js';
import { InMemoryOfflineSnapshotsRepository } from './infrastructure/in-memory-offline-snapshots.repository.js';
import { OfflineEventsService } from './offline-events.service.js';
import { OfflineReconciler } from './offline-reconciler.js';
import { OfflineReviewService } from './offline-review.service.js';
import { OfflineSnapshotService } from './offline-snapshot.service.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { MONDAY_9AM_BOGOTA } from '../schedules/testing.js';
import type { StudentsService } from '../students/students.service.js';

export { bogota };

export const DEVICE = 'esp32-1';

/** Unix seconds of a Bogota time of the test day. */
export const unix = (time: string, date = '2026-11-02'): number =>
  Math.floor(bogota(time, date).getTime() / 1000);

/**
 * Test fixture: offline mode on in-memory repositories with the real alarm,
 * attendance and schedules services and a movable clock. The default clock is
 * 11:30, after the 10:00-11:00 schedule `A` the helpers create.
 */
export function buildOfflineFixture(
  start: Date = bogota('11:30'),
  config: OfflineConfig = defaultOfflineConfig,
) {
  // Assignments are valid from "now": create them in the morning, then move on.
  const base = buildAlarmFixture(MONDAY_9AM_BOGOTA);
  const events = new InMemoryOfflineEventsRepository();
  const snapshots = new InMemoryOfflineSnapshotsRepository();
  const reconciler = new OfflineReconciler(
    base.attendance,
    events,
    config,
    base.clock,
  );
  const systemEvents = base.systemEvents as SystemEventsService;
  const service = new OfflineEventsService(
    events,
    snapshots,
    reconciler,
    base.attendance,
    base.service,
    base.instances,
    base.students,
    base.eventLogService,
    systemEvents,
    base.clock,
  );
  const review = new OfflineReviewService(
    events,
    reconciler,
    base.attendance,
    base.service,
    base.students,
    base.instances,
    base.eventLogService,
    systemEvents,
    base.clock,
  );
  const snapshotService = new OfflineSnapshotService(
    snapshots,
    base.devices,
    base.link.sender,
    base.attendance,
    base.students as StudentsService,
    config,
    base.clock,
  );

  /** Schedule `A` (10:00-11:00) with these students assigned; returns them. */
  async function world(documents: string[] = ['1']) {
    const schedule = await base.weekly('A', '10:00', '11:00');
    const people = [];
    for (const document of documents) {
      const student = await base.newStudent(document);
      await base.schedules.assignStudent(schedule.schedule.id, student.id);
      people.push(student);
    }
    base.setNow(start);
    return { schedule, students: people };
  }

  /** A roster the reader decided with: slot n belongs to the n-th student. */
  async function snapshotOf(
    scheduleId: string | null,
    roster: Record<number, string>,
    createdAt = start,
  ): Promise<string> {
    const id = randomUUID();
    await snapshots.save({
      id,
      deviceId: DEVICE,
      scheduleId,
      roster,
      createdAt,
    });
    return id;
  }

  let seq = 0;
  const event = (
    snapshotId: string,
    type: 'entry' | 'exit',
    slot: number,
    time: string,
    over: Record<string, unknown> = {},
  ) => ({
    id: randomUUID(),
    seq: ++seq,
    ts: unix(time),
    snapshotId,
    type,
    slot,
    ...over,
  });

  let messages = 0;
  const batch = (
    list: unknown[],
    over: { last?: boolean; messageId?: string } = {},
  ) => ({
    messageId: over.messageId ?? randomUUID(),
    batch: ++messages,
    last: over.last ?? true,
    events: list,
  });

  return {
    ...base,
    /** The alarm repository (`events` is the offline one). */
    alarmEvents: base.events,
    events,
    snapshots,
    reconciler,
    offline: service,
    review,
    snapshotService,
    world,
    snapshotOf,
    event,
    batch,
    alarmService: base.service,
    config,
    DEVICE,
  };
}
