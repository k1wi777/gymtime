import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { Keyring } from './crypto/keyring.js';
import { KeyringGuard } from './crypto/keyring.guard.js';
import { DevicesModule } from '../devices/devices.module.js';
import { StudentsModule } from '../students/students.module.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import { TemplateCipher } from './crypto/template-cipher.service.js';
import { ENROLLMENTS_REPOSITORY } from './domain/enrollments.repository.js';
import { FINGERPRINTS_REPOSITORY } from './domain/fingerprints.repository.js';
import { EnrollmentEventsRegistrar } from './enrollment-events.registrar.js';
import { EnrollmentExpirer } from './enrollment-expirer.js';
import { EnrollmentService } from './enrollment.service.js';
import { FingerprintsService } from './fingerprints.service.js';
import { EnrollmentsController } from './enrollments.controller.js';
import {
  FINGERPRINTS_CONFIG,
  defaultFingerprintsConfig,
} from './fingerprints.config.js';
import { PrismaEnrollmentsRepository } from './infrastructure/prisma-enrollments.repository.js';
import { PrismaFingerprintsRepository } from './infrastructure/prisma-fingerprints.repository.js';

@Module({
  imports: [StudentsModule, DevicesModule],
  controllers: [EnrollmentsController],
  providers: [
    { provide: FINGERPRINTS_CONFIG, useValue: defaultFingerprintsConfig },
    { provide: CLOCK, useValue: systemClock },
    {
      provide: ENROLLMENTS_REPOSITORY,
      useClass: PrismaEnrollmentsRepository,
    },
    {
      provide: FINGERPRINTS_REPOSITORY,
      useClass: PrismaFingerprintsRepository,
    },
    {
      provide: Keyring,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        Keyring.fromSettings({
          ENCRYPTION_KEY: config.get('ENCRYPTION_KEY', { infer: true }),
          ENCRYPTION_KEY_VERSION: config.get('ENCRYPTION_KEY_VERSION', {
            infer: true,
          }),
          ENCRYPTION_KEYS_RETIRED: config.get('ENCRYPTION_KEYS_RETIRED', {
            infer: true,
          }),
        }),
    },
    TemplateCipher,
    KeyringGuard,
    EnrollmentService,
    FingerprintsService,
    EnrollmentEventsRegistrar,
    EnrollmentExpirer,
  ],
  exports: [FingerprintsService, EnrollmentService],
})
export class FingerprintsModule {}
