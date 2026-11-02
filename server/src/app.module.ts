import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { AlarmModule } from './alarm/alarm.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { AppLoggerModule } from './common/logging/app-logger.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { SyncModule } from './sync/sync.module.js';
import { FingerprintsModule } from './fingerprints/fingerprints.module.js';
import { HealthModule } from './health/health.module.js';
import { SchedulesModule } from './schedules/schedules.module.js';
import { StudentsModule } from './students/students.module.js';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DatabaseModule,
    HealthModule,
    DevicesModule,
    StudentsModule,
    FingerprintsModule,
    SchedulesModule,
    SyncModule,
    AttendanceModule,
    AlarmModule,
  ],
})
export class AppModule {}
