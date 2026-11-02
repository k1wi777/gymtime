import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import type { Env } from '../config/env.schema.js';
import { StudentsModule } from '../students/students.module.js';
import { INSTANCES_REPOSITORY } from './domain/instances.repository.js';
import { SCHEDULES_REPOSITORY } from './domain/schedules.repository.js';
import { PrismaInstancesRepository } from './infrastructure/prisma-instances.repository.js';
import { PrismaSchedulesRepository } from './infrastructure/prisma-schedules.repository.js';
import { InstancesService } from './instances.service.js';
import {
  SCHEDULES_CONFIG,
  INSTANCE_HORIZON_DAYS,
  type SchedulesConfig,
} from './schedules.config.js';
import { SchedulesController } from './schedules.controller.js';
import { SchedulesService } from './schedules.service.js';

@Module({
  imports: [StudentsModule],
  controllers: [SchedulesController],
  providers: [
    {
      provide: SCHEDULES_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SchedulesConfig => ({
        entryOpenMinutes: config.get('ENTRY_OPEN_MINUTES', { infer: true }),
        entryCloseMinutes: config.get('ENTRY_CLOSE_MINUTES', { infer: true }),
        instanceHorizonDays: INSTANCE_HORIZON_DAYS,
      }),
    },
    { provide: CLOCK, useValue: systemClock },
    { provide: SCHEDULES_REPOSITORY, useClass: PrismaSchedulesRepository },
    { provide: INSTANCES_REPOSITORY, useClass: PrismaInstancesRepository },
    ApiKeyGuard,
    InstancesService,
    SchedulesService,
  ],
  exports: [SchedulesService, InstancesService],
})
export class SchedulesModule {}
