import { Module } from '@nestjs/common';
import { ConnectionRegistry } from './connection-registry.js';
import { DeviceGateway } from './device-gateway.js';
import { DEVICES_CONFIG, defaultDevicesConfig } from './devices.config.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';
import { DisplayService } from './display.service.js';
import { DEVICE_COMMANDS_REPOSITORY } from './domain/device-commands.repository.js';
import { DEVICES_REPOSITORY } from './domain/devices.repository.js';
import { PROCESSED_MESSAGES_REPOSITORY } from './domain/processed-messages.repository.js';
import { PrismaDeviceCommandsRepository } from './infrastructure/prisma-device-commands.repository.js';
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
      provide: DEVICE_COMMANDS_REPOSITORY,
      useClass: PrismaDeviceCommandsRepository,
    },
    {
      provide: PROCESSED_MESSAGES_REPOSITORY,
      useClass: PrismaProcessedMessagesRepository,
    },
    ConnectionRegistry,
    DevicesService,
    DisplayService,
    MessageProcessor,
    OutboundSender,
    DeviceGateway,
  ],
  exports: [DevicesService, DisplayService, OutboundSender, MessageProcessor],
})
export class DevicesModule {}
