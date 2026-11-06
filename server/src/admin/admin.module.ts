import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventsController } from './events.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [EventsController],
})
export class AdminModule {}
