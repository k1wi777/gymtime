import { Global, Module } from '@nestjs/common';
import { SystemEventsService } from './system-events.service.js';

@Global()
@Module({
  providers: [SystemEventsService],
  exports: [SystemEventsService],
})
export class SystemEventsModule {}
