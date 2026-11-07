import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlarmModule } from '../alarm/alarm.module.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import type { Env } from '../config/env.schema.js';
import { DevicesModule } from '../devices/devices.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { StudentsModule } from '../students/students.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { OFFLINE_EVENTS_REPOSITORY } from './domain/offline-events.repository.js';
import { OFFLINE_SNAPSHOTS_REPOSITORY } from './domain/offline-snapshots.repository.js';
import { PrismaOfflineEventsRepository } from './infrastructure/prisma-offline-events.repository.js';
import { PrismaOfflineSnapshotsRepository } from './infrastructure/prisma-offline-snapshots.repository.js';
import {
  OFFLINE_CONFIG,
  MIN_EVENT_TS,
  type OfflineConfig,
} from './offline.config.js';
import { OfflineController } from './offline.controller.js';
import { OfflineEventsService } from './offline-events.service.js';
import { OfflineReconciler } from './offline-reconciler.js';
import { OfflineRegistrar } from './offline.registrar.js';
import { OfflineReviewService } from './offline-review.service.js';
import { OfflineSnapshotService } from './offline-snapshot.service.js';

@Module({
  imports: [
    AlarmModule,
    AttendanceModule,
    DevicesModule,
    SchedulesModule,
    StudentsModule,
    SyncModule,
  ],
  controllers: [OfflineController],
  providers: [
    {
      provide: OFFLINE_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): OfflineConfig => ({
        limits: {
          futureToleranceSec: config.get('OFFLINE_TS_FUTURE_TOLERANCE_SEC', {
            infer: true,
          }),
          maxAgeSec:
            config.get('OFFLINE_TS_MAX_AGE_HOURS', { infer: true }) * 3600,
          minTs: MIN_EVENT_TS,
        },
        snapshotWaitSec: config.get('OFFLINE_SNAPSHOT_WAIT_SEC', {
          infer: true,
        }),
        retentionDays: config.get('OFFLINE_SNAPSHOT_RETENTION_DAYS', {
          infer: true,
        }),
      }),
    },
    { provide: CLOCK, useValue: systemClock },
    {
      provide: OFFLINE_EVENTS_REPOSITORY,
      useClass: PrismaOfflineEventsRepository,
    },
    {
      provide: OFFLINE_SNAPSHOTS_REPOSITORY,
      useClass: PrismaOfflineSnapshotsRepository,
    },
    OfflineReconciler,
    OfflineEventsService,
    OfflineSnapshotService,
    OfflineReviewService,
    OfflineRegistrar,
  ],
  exports: [OfflineReviewService],
})
export class OfflineModule {}
