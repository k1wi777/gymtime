import {
  Global,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ActorMiddleware } from './actor.middleware.js';
import { EVENT_LOG_REPOSITORY } from './event-log.repository.js';
import { EventLogService } from './event-log.service.js';
import { PrismaEventLogRepository } from './prisma-event-log.repository.js';

@Global()
@Module({
  providers: [
    { provide: EVENT_LOG_REPOSITORY, useClass: PrismaEventLogRepository },
    EventLogService,
  ],
  exports: [EventLogService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ActorMiddleware).forRoutes('*');
  }
}
