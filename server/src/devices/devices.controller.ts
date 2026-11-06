import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { API_KEY_HEADER, ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import type { z } from 'zod';
import type { DeviceStatus } from './domain/device.js';
import { DevicesService } from './devices.service.js';
import { DisplayService, type DisplayOutcome } from './display.service.js';
import { DisplayValidationError } from '../common/display/display.errors.js';
import { NoDeviceError } from './domain/no-device.error.js';
import {
  SendMessageDto,
  SendMessageResultDto,
  sendMessageSchema,
} from './dto/display.dto.js';

@ApiTags('devices')
@ApiHeader({ name: API_KEY_HEADER, required: true })
@UseGuards(ApiKeyGuard)
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly display: DisplayService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Connection state of every known device' })
  @ApiOkResponse({
    description:
      'deviceId, online, lastConnectedAt, firmwareVersion and pendingCommands',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key' })
  status(): Promise<DeviceStatus[]> {
    return this.devices.listStatus();
  }

  @Post('messages')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Show a message on the reader LCD (display.message)',
    description:
      'Persisted and delivered like any order: when the device is offline it is queued and sent on reconnection.',
  })
  @ApiBody({ type: SendMessageDto })
  @ApiOkResponse({ type: SendMessageResultDto })
  @ApiBadRequestResponse({
    description: 'Invalid body or lines that do not fit the screen',
  })
  @ApiNotFoundResponse({ description: 'No device known (NO_DEVICE)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key' })
  async sendMessage(
    @Body(new ZodValidationPipe(sendMessageSchema))
    body: z.infer<typeof sendMessageSchema>,
  ): Promise<DisplayOutcome> {
    try {
      return await this.display.show(body);
    } catch (error) {
      if (error instanceof DisplayValidationError) {
        throw new BadRequestException({
          message: error.message,
          issues: error.errors,
        });
      }
      if (error instanceof NoDeviceError) {
        throw new NotFoundException({
          code: 'NO_DEVICE',
          message: error.message,
        });
      }
      throw error;
    }
  }
}
