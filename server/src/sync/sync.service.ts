import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PROTOCOL_VERSION, type ServerMessage } from '@gymtime/shared';
import { EventLogService } from '../common/audit/event-log.service.js';
import { KeyedMutex } from '../common/concurrency/keyed-mutex.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { DevicesService } from '../devices/devices.service.js';
import {
  OutboundSender,
  type SendResult,
} from '../devices/outbound-sender.service.js';
import type { Student } from '../students/domain/student.js';
import { StudentsService } from '../students/students.service.js';
import {
  EmptyOpenSessionsProvider,
  type OpenSessionsProvider,
} from './domain/open-sessions.provider.js';
import {
  SLOTS_REPOSITORY,
  type SlotsRepository,
} from './domain/slots.repository.js';
import type { PlannedSchedule, SyncPlan } from './domain/sync-plan.js';
import { SyncPlanner } from './sync-planner.service.js';
import { SYNC_CONFIG, type SyncConfig } from './sync.config.js';

export type SyncReason =
  | 'connected'
  | 'enrollment'
  | 'before_start'
  | 'after_end'
  | 'manual'
  | 'attendance'
  | 'erasure';

export type SyncFailure = 'PLAN_FAILED' | 'CHUNK_FAILED';

export interface SyncResult {
  status: 'ok' | 'failed';
  syncId: string;
  deviceId: string;
  reason: SyncReason;
  /** Templates loaded (all of them for `ok`; those sent so far otherwise). */
  templates: number;
  chunks: number;
  scheduleId: string | null;
  omitted: number;
  error: SyncFailure | null;
}

export class NoDeviceOnlineError extends Error {
  constructor() {
    super('No single device is online; connect one');
  }
}

/**
 * Loads the reader with the templates it needs: builds the plan, stores the
 * slot map, then sends `templates.sync` chunk by chunk (each one acked) and
 * finally `schedule.set`. Syncs of a device never overlap.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly mutex = new KeyedMutex();
  // A sync waiting for the running one; later requests merge into it.
  private readonly queued = new Map<string, Promise<SyncResult>>();
  private openSessions: OpenSessionsProvider = new EmptyOpenSessionsProvider();

  constructor(
    private readonly planner: SyncPlanner,
    @Inject(SLOTS_REPOSITORY) private readonly slots: SlotsRepository,
    private readonly sender: OutboundSender,
    private readonly devices: DevicesService,
    private readonly students: StudentsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SYNC_CONFIG) private readonly config: SyncConfig,
    private readonly eventLog: EventLogService,
  ) {}

  /**
   * Extension point for the attendance module: which students keep their
   * template loaded because they still have an open session.
   */
  setOpenSessionsProvider(provider: OpenSessionsProvider): void {
    this.openSessions = provider;
  }

  /** Student whose template the last sync loaded into `slot` (any state), or null. */
  async findStudentBySlot(
    deviceId: string,
    slot: number,
  ): Promise<Student | null> {
    const studentId = await this.slots.findStudentIdBySlot(deviceId, slot);
    return studentId ? this.students.findById(studentId) : null;
  }

  /**
   * Automatic trigger. Never rejects: with no device it is skipped and logged.
   * Returns the result, or null when skipped.
   */
  async requestSync(
    reason: SyncReason,
    deviceId?: string,
  ): Promise<SyncResult | null> {
    const target = deviceId ?? (await this.safeOnlineDevice());
    if (!target) {
      this.logger.log({ event: 'sync_skipped', reason, cause: 'no_device' });
      return null;
    }
    return this.run(target, reason);
  }

  /** Manual sync of the only online device. @throws NoDeviceOnlineError */
  async syncOnline(reason: SyncReason = 'manual'): Promise<SyncResult> {
    const deviceId = await this.devices.getOnlineDeviceId();
    if (!deviceId) throw new NoDeviceOnlineError();
    const result = await this.run(deviceId, reason);
    // Only the operator's request is audited here; the scheduled and
    // connection triggers are system activity.
    if (reason === 'manual') {
      await this.eventLog.record('sync.triggered', {
        deviceId,
        status: result.status,
        loaded: result.templates,
      });
    }
    return result;
  }

  private run(deviceId: string, reason: SyncReason): Promise<SyncResult> {
    const waiting = this.queued.get(deviceId);
    if (waiting) return waiting;
    const next = this.mutex.run(deviceId, () => {
      this.queued.delete(deviceId);
      return this.execute(deviceId, reason);
    });
    this.queued.set(deviceId, next);
    return next;
  }

  private async safeOnlineDevice(): Promise<string | null> {
    try {
      return await this.devices.getOnlineDeviceId();
    } catch (error) {
      this.logger.error({
        event: 'sync_device_lookup_failed',
        error: message(error),
      });
      return null;
    }
  }

  /** Never rejects: a failure is reported in the result. */
  private async execute(
    deviceId: string,
    reason: SyncReason,
  ): Promise<SyncResult> {
    const syncId = randomUUID();
    const result: SyncResult = {
      status: 'failed',
      syncId,
      deviceId,
      reason,
      templates: 0,
      chunks: 0,
      scheduleId: null,
      omitted: 0,
      error: null,
    };
    let plan: SyncPlan;
    try {
      plan = await this.planner.build(this.clock.now(), this.openSessions);
      // Saved before sending: the reader wipes everything on the first chunk.
      await this.slots.replace(deviceId, syncId, plan.slots);
    } catch (error) {
      this.logger.error({
        event: 'sync_failed',
        syncId,
        deviceId,
        reason,
        cause: 'plan',
        error: message(error),
      });
      return { ...result, error: 'PLAN_FAILED' };
    }

    const total = Math.max(
      1,
      Math.ceil(plan.slots.length / this.config.chunkSize),
    );
    result.omitted = plan.omitted;
    this.logger.log({
      event: 'sync_started',
      syncId,
      deviceId,
      reason,
      templates: plan.slots.length,
      chunks: total,
      omitted: plan.omitted,
    });

    for (let index = 1; index <= total; index++) {
      const from = (index - 1) * this.config.chunkSize;
      const slice = plan.slots.slice(from, from + this.config.chunkSize);
      const chunk = this.chunkMessage(
        syncId,
        index,
        total,
        slice.map((s, i) => ({
          slot: s.slot,
          template: plan.templates[from + i].toString('base64'),
        })),
      );
      if ((await this.sendWithRetries(deviceId, chunk)) === 'failed') {
        this.logger.error({
          event: 'sync_failed',
          syncId,
          deviceId,
          reason,
          cause: 'chunk',
          chunk: index,
          of: total,
        });
        return { ...result, error: 'CHUNK_FAILED' };
      }
      result.chunks = index;
      result.templates += slice.length;
      this.logger.log({
        event: 'chunk_sent',
        syncId,
        index,
        of: total,
        slots: slice.map((s) => s.slot),
      });
    }

    if (plan.schedule) {
      result.scheduleId = plan.schedule.scheduleId;
      await this.sendSchedule(deviceId, syncId, plan.schedule);
    }
    this.logger.log({
      event: 'sync_done',
      syncId,
      deviceId,
      reason,
      templates: result.templates,
      chunks: result.chunks,
      scheduleId: result.scheduleId,
    });
    return { ...result, status: 'ok' };
  }

  /** Resends the very same message (same id) when the sender gave up on it. */
  private async sendWithRetries(
    deviceId: string,
    message: ServerMessage,
  ): Promise<SendResult> {
    let result: SendResult = 'failed';
    for (let attempt = 0; attempt <= this.config.chunkRetries; attempt++) {
      result = await this.sender.send(deviceId, message);
      if (result === 'acked') break;
    }
    return result;
  }

  /** Its failure is logged but does not invalidate the template sync. */
  private async sendSchedule(
    deviceId: string,
    syncId: string,
    schedule: PlannedSchedule,
  ): Promise<void> {
    const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
    const result = await this.sender.send(
      deviceId,
      this.envelope('schedule.set', {
        scheduleId: schedule.scheduleId,
        start: seconds(schedule.startsAt),
        end: seconds(schedule.endsAt),
        entryOpensAt: seconds(schedule.entryOpensAt),
        entryClosesAt: seconds(schedule.entryClosesAt),
      }),
    );
    if (result === 'failed') {
      this.logger.warn({
        event: 'schedule_set_failed',
        syncId,
        deviceId,
        scheduleId: schedule.scheduleId,
      });
    }
  }

  private chunkMessage(
    syncId: string,
    index: number,
    total: number,
    templates: { slot: number; template: string }[],
  ): ServerMessage {
    return this.envelope('templates.sync', {
      syncId,
      chunk: { index, total },
      templates,
    });
  }

  private envelope<T extends 'templates.sync' | 'schedule.set'>(
    type: T,
    payload: Extract<ServerMessage, { type: T }>['payload'],
  ): ServerMessage {
    return {
      v: PROTOCOL_VERSION,
      id: randomUUID(),
      type,
      ts: Math.floor(this.clock.now().getTime() / 1000),
      ref: null,
      payload,
    } as ServerMessage;
  }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
