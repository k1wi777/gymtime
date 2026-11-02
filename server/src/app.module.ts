import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { AppLoggerModule } from './common/logging/app-logger.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [AppConfigModule, AppLoggerModule, DatabaseModule, HealthModule],
})
export class AppModule {}
