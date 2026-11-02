import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { ConnectionRegistry } from './connection-registry.js';
import { DeviceGateway } from './device-gateway.js';
import { DEVICES_CONFIG, defaultDevicesConfig } from './devices.config.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';
import { DEVICES_REPOSITORY } from './domain/devices.repository.js';
import { PROCESSED_MESSAGES_REPOSITORY } from './domain/processed-messages.repository.js';
import { PrismaDevicesRepository } from './infrastructure/prisma-devices.repository.js';
import { PrismaProcessedMessagesRepository } from './infrastructure/prisma-processed-messages.repository.js';
import { MessageProcessor } from './message-processor.service.js';
import { OutboundSender } from './outbound-sender.service.js';

@Module({
  controllers: [DevicesController],
  providers: [
    { provide: DEVICES_CONFIG, useValue: defaultDevicesConfig },
    { provide: DEVICES_REPOSITORY, useClass: PrismaDevicesRepository },
    {
      provide: PROCESSED_MESSAGES_REPOSITORY,
      useClass: PrismaProcessedMessagesRepository,
    },
    ApiKeyGuard,
    ConnectionRegistry,
    DevicesService,
    MessageProcessor,
    OutboundSender,
    DeviceGateway,
  ],
  exports: [DevicesService, OutboundSender, MessageProcessor],
})
export class DevicesModule {}
