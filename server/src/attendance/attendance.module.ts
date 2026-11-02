import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import { DevicesModule } from '../devices/devices.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { StudentsModule } from '../students/students.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceEventsRegistrar } from './attendance-events.registrar.js';
import { AttendanceService } from './attendance.service.js';
import { ATTENDANCE_REPOSITORY } from './domain/attendance.repository.js';
import { ALARM_PORT, NoopAlarmPort } from './domain/alarm.port.js';
import { PrismaAttendanceRepository } from './infrastructure/prisma-attendance.repository.js';

@Module({
  imports: [DevicesModule, SyncModule, SchedulesModule, StudentsModule],
  controllers: [AttendanceController],
  providers: [
    { provide: CLOCK, useValue: systemClock },
    { provide: ALARM_PORT, useClass: NoopAlarmPort },
    {
      provide: ATTENDANCE_REPOSITORY,
      useClass: PrismaAttendanceRepository,
    },
    ApiKeyGuard,
    AttendanceService,
    AttendanceEventsRegistrar,
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
