import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';

const HOUR_MS = 3_600_000;

/** Keeps `auth_sessions` from growing: purges dead sessions at start and hourly. */
@Injectable()
export class SessionCleanup implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanup.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly auth: AuthService) {}

  async onModuleInit(): Promise<void> {
    await this.purge();
    this.timer = setInterval(() => void this.purge(), HOUR_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async purge(): Promise<void> {
    try {
      const removed = await this.auth.purgeDeadSessions();
      if (removed > 0) {
        this.logger.log({ event: 'sessions_purged', removed });
      }
    } catch (error) {
      this.logger.warn({
        event: 'sessions_purge_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
