import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
import { ApiAuth } from '../common/auth/roles.decorator.js';

@ApiTags('devices')
@ApiAuth()
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
