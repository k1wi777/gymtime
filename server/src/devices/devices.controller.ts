import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { API_KEY_HEADER, ApiKeyGuard } from '../common/auth/api-key.guard.js';
import type { DeviceStatus } from './domain/device.js';
import { DevicesService } from './devices.service.js';

@ApiTags('devices')
@ApiHeader({ name: API_KEY_HEADER, required: true })
@UseGuards(ApiKeyGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get('status')
  @ApiOperation({ summary: 'Connection state of every known device' })
  @ApiOkResponse({
    description: 'deviceId, online, lastConnectedAt and firmwareVersion',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key' })
  status(): Promise<DeviceStatus[]> {
    return this.devices.listStatus();
  }
}
