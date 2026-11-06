import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLOCK, systemClock } from '../common/time/clock.js';
import type { Env } from '../config/env.schema.js';
import { DevicesModule } from '../devices/devices.module.js';
import { FingerprintsModule } from '../fingerprints/fingerprints.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { StudentsModule } from '../students/students.module.js';
import { SLOTS_REPOSITORY } from './domain/slots.repository.js';
import { PrismaSlotsRepository } from './infrastructure/prisma-slots.repository.js';
import { SyncPlanner } from './sync-planner.service.js';
import { SyncScheduler } from './sync-scheduler.js';
import { SyncTriggersRegistrar } from './sync-triggers.registrar.js';
import {
  SYNC_CONFIG,
  defaultSyncConfig,
  type SyncConfig,
} from './sync.config.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

/**
 * Exports `SyncService`, the surface the attendance module will use:
 * `setOpenSessionsProvider`, `requestSync` and `findStudentBySlot`.
 */
@Module({
  imports: [DevicesModule, FingerprintsModule, SchedulesModule, StudentsModule],
  controllers: [SyncController],
  providers: [
    {
      provide: SYNC_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SyncConfig => ({
        ...defaultSyncConfig,
        leadMinutes: config.get('SYNC_LEAD_MINUTES', { infer: true }),
      }),
    },
    { provide: CLOCK, useValue: systemClock },
    { provide: SLOTS_REPOSITORY, useClass: PrismaSlotsRepository },
    SyncPlanner,
    SyncService,
    SyncScheduler,
    SyncTriggersRegistrar,
  ],
  exports: [SyncService],
})
export class SyncModule {}
