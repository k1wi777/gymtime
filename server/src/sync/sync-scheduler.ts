import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { CLOCK, type Clock } from '../common/time/clock.js';
import {
  ALWAYS_LEADER,
  LEADER_LOCK,
  type LeaderLock,
} from '../common/concurrency/leader-lock.js';
import { InstancesService } from '../schedules/instances.service.js';
import { SyncService, type SyncReason } from './sync.service.js';
import { SYNC_CONFIG, type SyncConfig } from './sync.config.js';

/**
 * Time-based sync triggers: `leadMinutes` before each occurrence starts and
 * when each one ends. Every tick also tops up the generated occurrences.
 *
 * Triggers come from the occurrence data itself, so there is no cron table to
 * keep in step with schedule edits, and the clock is injected so tests can walk
 * through a day. Edges missed while the server was down are not replayed: the
 * sync on connection covers that.
 */
@Injectable()
export class SyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private lastTick: Date;
  private ticking = false;

  constructor(
    private readonly instances: InstancesService,
    private readonly sync: SyncService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SYNC_CONFIG) private readonly config: SyncConfig,
    @Inject(LEADER_LOCK) private readonly lock: LeaderLock = ALWAYS_LEADER,
  ) {
    this.lastTick = this.clock.now();
  }

  onModuleInit(): void {
    this.lastTick = this.clock.now();
    void this.ensureHorizon();
    this.timer = setInterval(() => void this.tick(), this.config.tickMs);
    // The scheduler must not keep the process alive.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * One pass over the interval (lastTick, now]. Never throws: a failing pass
   * is logged and its interval is examined again by the next one.
   */
  async tick(): Promise<void> {
    // Without the lock the interval is not consumed: a new leader examines it
    // from its own last tick, which the first pass as leader resets.
    if (!this.lock.isLeader()) {
      this.lastTick = this.clock.now();
      return;
    }
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.clock.now();
      await this.instances.ensureHorizon(now);
      const { starting, ended } = await this.instances.listWithEdgesBetween(
        this.lastTick,
        now,
        this.config.leadMinutes,
      );
      this.lastTick = now;
      const reason: SyncReason | null =
        starting.length > 0
          ? 'before_start'
          : ended.length > 0
            ? 'after_end'
            : null;
      // One sync covers every edge in the interval.
      if (reason) await this.sync.requestSync(reason);
    } catch (error) {
      this.logger.error({
        event: 'sync_tick_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.ticking = false;
    }
  }

  private async ensureHorizon(): Promise<void> {
    if (!this.lock.isLeader()) return;
    try {
      await this.instances.ensureHorizon(this.clock.now());
    } catch (error) {
      this.logger.error({
        event: 'ensure_horizon_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
