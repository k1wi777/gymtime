import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { InstancesService } from '../schedules/instances.service.js';
import { ALARM_CONFIG, type AlarmConfig } from './alarm.config.js';
import { AlarmService } from './alarm.service.js';

/**
 * Drives the alarm with a fast tick (500 ms), so an occurrence end is seen
 * within ±1 s. The first pass tops up the generated occurrences and restores
 * the open alarms from the database; a failing pass is logged and retried,
 * never thrown.
 */
@Injectable()
export class AlarmScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlarmScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private recovered = false;

  constructor(
    private readonly instances: InstancesService,
    private readonly alarm: AlarmService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ALARM_CONFIG) private readonly config: AlarmConfig,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.config.tickMs);
    // The scheduler must not keep the process alive.
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass; the first one recovers and only the following ones evaluate time. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!this.recovered) {
        await this.bootstrap();
        return;
      }
      await this.alarm.tick(this.clock.now());
    } catch (error) {
      this.logger.error({
        event: 'alarm_tick_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.ticking = false;
    }
  }

  private async bootstrap(): Promise<void> {
    const now = this.clock.now();
    await this.instances.ensureHorizon(now);
    await this.alarm.recover(now);
    this.recovered = true;
  }
}
