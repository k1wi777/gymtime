import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EventLogService } from '../../common/audit/event-log.service.js';
import { runAsActor, SYSTEM_ACTOR } from '../../common/audit/actor.js';
import { toBogotaParts } from '../../common/time/bogota.js';
import { CLOCK, type Clock } from '../../common/time/clock.js';
import { InstancesService } from '../instances.service.js';

const CHECK_MS = 5 * 60_000;

/**
 * Daily safety net (E18-5): at startup and whenever the Bogota date changes,
 * makes sure the active period has all its occurrences. Idempotent; a failure
 * is logged and never stops the server.
 */
@Injectable()
export class OccurrenceRepairJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OccurrenceRepairJob.name);
  private timer: NodeJS.Timeout | undefined;
  private lastDay: string | undefined;

  constructor(
    private readonly instances: InstancesService,
    private readonly eventLog: EventLogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => void this.check(), CHECK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Runs the repair when the day has not been checked yet; returns the repaired count. */
  async check(): Promise<number> {
    const now = this.clock.now();
    const day = toBogotaParts(now).date;
    if (day === this.lastDay) return 0;
    try {
      const created = await this.instances.repairActivePeriod(now);
      this.lastDay = day;
      if (created > 0) {
        this.logger.log({ event: 'occurrences_repaired', created });
        await runAsActor(SYSTEM_ACTOR, () =>
          this.eventLog.record('period.occurrences_repaired', { created }),
        );
      }
      return created;
    } catch (error) {
      // Not marked as checked: the next pass retries.
      this.logger.error({
        event: 'occurrences_repair_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
