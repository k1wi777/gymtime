import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
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
