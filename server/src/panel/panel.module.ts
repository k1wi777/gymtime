import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { AlarmModule } from '../alarm/alarm.module.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import { FingerprintsModule } from '../fingerprints/fingerprints.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { StudentsModule } from '../students/students.module.js';
import { PanelAdminController } from './panel-admin.controller.js';
import { PanelAdminService } from './panel-admin.service.js';
import { PanelController } from './panel.controller.js';
import { PanelService } from './panel.service.js';

@Module({
  imports: [
    AlarmModule,
    AuthModule,
    DevicesModule,
    AttendanceModule,
    FingerprintsModule,
    SchedulesModule,
    StudentsModule,
  ],
  controllers: [PanelController, PanelAdminController],
  providers: [
    { provide: CLOCK, useValue: systemClock },
    PanelService,
    PanelAdminService,
  ],
})
export class PanelModule {}
