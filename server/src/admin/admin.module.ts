import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { EventsController } from './events.controller.js';

@Module({
  controllers: [EventsController],
  providers: [ApiKeyGuard],
})
export class AdminModule {}
