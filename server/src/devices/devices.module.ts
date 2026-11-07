import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import { ConnectionRegistry } from './connection-registry.js';
import { DeviceTokensService } from './device-tokens.service.js';
import { DeviceGateway } from './device-gateway.js';
import {
  DEVICES_CONFIG,
  defaultDevicesConfig,
  type DevicesConfig,
} from './devices.config.js';
import { DeviceOfflineMonitor } from './device-offline-monitor.js';
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
    {
      provide: DEVICES_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DevicesConfig => ({
        ...defaultDevicesConfig,
        offlineAlertMinutes: config.get('DEVICE_OFFLINE_ALERT_MINUTES', {
          infer: true,
        }),
      }),
    },
    { provide: DEVICES_REPOSITORY, useClass: PrismaDevicesRepository },
    {
      provide: DEVICE_COMMANDS_REPOSITORY,
      useClass: PrismaDeviceCommandsRepository,
    },
    {
      provide: PROCESSED_MESSAGES_REPOSITORY,
      useClass: PrismaProcessedMessagesRepository,
    },
    { provide: CLOCK, useValue: systemClock },
    ConnectionRegistry,
    DeviceTokensService,
    DevicesService,
    DisplayService,
    MessageProcessor,
    OutboundSender,
    DeviceGateway,
    DeviceOfflineMonitor,
  ],
  exports: [
    DevicesService,
    DeviceTokensService,
    DisplayService,
    OutboundSender,
    MessageProcessor,
  ],
})
export class DevicesModule {}
