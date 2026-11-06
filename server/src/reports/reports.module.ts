import { Module } from '@nestjs/common';
import { AlarmModule } from '../alarm/alarm.module.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import { DevicesModule } from '../devices/devices.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { StudentsModule } from '../students/students.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Reports and metrics (E23). No repository of its own: it reads through the services. */
@Module({
  imports: [
    AlarmModule,
    AttendanceModule,
    DevicesModule,
    SchedulesModule,
    StudentsModule,
  ],
  controllers: [ReportsController],
  providers: [{ provide: CLOCK, useValue: systemClock }, ReportsService],
})
export class ReportsModule {}
