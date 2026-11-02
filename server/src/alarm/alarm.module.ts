import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import type { Env } from '../config/env.schema.js';
import { DevicesModule } from '../devices/devices.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import {
  ALARM_CONFIG,
  ALARM_TICK_MS,
  type AlarmConfig,
} from './alarm.config.js';
import { AlarmController } from './alarm.controller.js';
import { AlarmRegistrar } from './alarm-registrar.js';
import { AlarmScheduler } from './alarm-scheduler.js';
import { AlarmService } from './alarm.service.js';
import { ALARM_REPOSITORY } from './domain/alarm.repository.js';
import { PrismaAlarmRepository } from './infrastructure/prisma-alarm.repository.js';

@Module({
  imports: [AttendanceModule, DevicesModule, SchedulesModule],
  controllers: [AlarmController],
  providers: [
    {
      provide: ALARM_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AlarmConfig => ({
        beepSeconds: config.get('ALARM_BEEP_SECONDS', { infer: true }),
        timeoutMinutes: config.get('ALARM_TIMEOUT_MINUTES', { infer: true }),
        tickMs: ALARM_TICK_MS,
      }),
    },
    { provide: CLOCK, useValue: systemClock },
    { provide: ALARM_REPOSITORY, useClass: PrismaAlarmRepository },
    ApiKeyGuard,
    AlarmService,
    AlarmScheduler,
    AlarmRegistrar,
  ],
  exports: [AlarmService],
})
export class AlarmModule {}
