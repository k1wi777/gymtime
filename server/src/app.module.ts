import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { DisplayConfigModule } from './config/display-config.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AlarmModule } from './alarm/alarm.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuditModule } from './common/audit/audit.module.js';
import { AppLoggerModule } from './common/logging/app-logger.module.js';
import { SystemEventsModule } from './common/events/system-events.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { SyncModule } from './sync/sync.module.js';
import { FingerprintsModule } from './fingerprints/fingerprints.module.js';
import { HealthModule } from './health/health.module.js';
import { PanelModule } from './panel/panel.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SchedulesModule } from './schedules/schedules.module.js';
import { StudentsModule } from './students/students.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    AppConfigModule,
    DisplayConfigModule,
    AppLoggerModule,
    SystemEventsModule,
    AuditModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    HealthModule,
    DevicesModule,
    StudentsModule,
    FingerprintsModule,
    SchedulesModule,
    SyncModule,
    AttendanceModule,
    AlarmModule,
    AdminModule,
    PanelModule,
    ReportsModule,
  ],
})
export class AppModule {}
