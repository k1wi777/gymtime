import { Module } from '@nestjs/common';
import { AlarmModule } from '../alarm/alarm.module.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import { FingerprintsModule } from '../fingerprints/fingerprints.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { StudentsModule } from '../students/students.module.js';
import { PanelController } from './panel.controller.js';
import { PanelService } from './panel.service.js';

@Module({
  imports: [
    AlarmModule,
    AttendanceModule,
    FingerprintsModule,
    SchedulesModule,
    StudentsModule,
  ],
  controllers: [PanelController],
  providers: [{ provide: CLOCK, useValue: systemClock }, PanelService],
})
export class PanelModule {}
