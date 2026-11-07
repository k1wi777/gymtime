import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ALWAYS_LEADER,
  LEADER_LOCK,
  type LeaderLock,
} from '../common/concurrency/leader-lock.js';
import { EnrollmentService } from './enrollment.service.js';
import {
  FINGERPRINTS_CONFIG,
  type FingerprintsConfig,
} from './fingerprints.config.js';

/**
 * Periodic sweep that expires enrollments the device never answered. It also
 * runs at startup, so enrollments that expired while the server was down are
 * closed and the reader is told to leave enrollment mode.
 */
@Injectable()
export class EnrollmentExpirer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EnrollmentExpirer.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly enrollments: EnrollmentService,
    @Inject(FINGERPRINTS_CONFIG) private readonly config: FingerprintsConfig,
    @Inject(LEADER_LOCK) private readonly lock: LeaderLock = ALWAYS_LEADER,
  ) {}

  onModuleInit(): void {
    void this.sweep();
    this.timer = setInterval(
      () => void this.sweep(),
      this.config.expirySweepMs,
    );
    // The sweep must not keep the process alive.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Never throws: a failing sweep is logged and retried on the next tick. */
  async sweep(): Promise<void> {
    if (!this.lock.isLeader()) return;
    try {
      await this.enrollments.expireOverdue();
    } catch (error) {
      this.logger.error({
        event: 'expiry_sweep_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
