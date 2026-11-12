import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  NotFoundException,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiBody,
  ApiConflictResponse,
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
  type SendMessageBody,
} from './dto/display.dto.js';
import { ApiAuth, Roles } from '../common/auth/roles.decorator.js';
import {
  DeviceAlreadyRegisteredError,
  DeviceTokensService,
  UnknownDeviceError,
  type IssuedToken,
} from './device-tokens.service.js';
import {
  IssuedTokenDto,
  RegisterDeviceDto,
  RevokedTokenDto,
  deviceIdSchema,
  registerDeviceSchema,
} from './dto/device-token.dto.js';
import { DeviceStatusDto } from './dto/device-status.dto.js';

@ApiTags('devices')
@ApiAuth()
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly display: DisplayService,
    private readonly tokens: DeviceTokensService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Connection state of every known device' })
  @ApiOkResponse({ type: [DeviceStatusDto] })
  status(): Promise<DeviceStatus[]> {
    return this.devices.listStatus();
  }

  @Post()
  @Roles('admin')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Register a device and issue its own token (shown once)',
    description:
      'Creates the device if needed. The token is returned only here; the server stores its hash.',
  })
  @ApiBody({ type: RegisterDeviceDto })
  @ApiCreatedResponse({ type: IssuedTokenDto })
  @ApiConflictResponse({
    description:
      'The device already has an own token (DEVICE_ALREADY_REGISTERED)',
  })
  async register(
    @Body(new ZodValidationPipe(registerDeviceSchema))
    body: z.infer<typeof registerDeviceSchema>,
  ): Promise<IssuedToken> {
    try {
      return await this.tokens.register(body.deviceId);
    } catch (error) {
      if (error instanceof DeviceAlreadyRegisteredError) {
        throw new ConflictException({
          code: 'DEVICE_ALREADY_REGISTERED',
          message: error.message,
        });
      }
      throw error;
    }
  }

  @Post(':id/token/rotate')
  @Roles('admin')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Rotate the token: the old one dies at once and the connection closes',
  })
  @ApiOkResponse({ type: IssuedTokenDto })
  @ApiNotFoundResponse({ description: 'Unknown device (DEVICE_NOT_FOUND)' })
  async rotate(@Param('id') id: string): Promise<IssuedToken> {
    return this.guarded(() => this.tokens.rotate(deviceIdSchema.parse(id)), id);
  }

  @Post(':id/token/revoke')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Revoke the token: nothing is accepted for the device until it is rotated',
  })
  @ApiOkResponse({ type: RevokedTokenDto })
  @ApiNotFoundResponse({ description: 'Unknown device (DEVICE_NOT_FOUND)' })
  async revoke(
    @Param('id') id: string,
  ): Promise<{ deviceId: string; tokenStatus: 'revoked' }> {
    await this.guarded(() => this.tokens.revoke(deviceIdSchema.parse(id)), id);
    return { deviceId: id, tokenStatus: 'revoked' };
  }

  private async guarded<T>(action: () => Promise<T>, id: string): Promise<T> {
    if (!deviceIdSchema.safeParse(id).success) {
      throw new BadRequestException({ code: 'INVALID_DEVICE_ID' });
    }
    try {
      return await action();
    } catch (error) {
      if (error instanceof UnknownDeviceError) {
        throw new NotFoundException({
          code: 'DEVICE_NOT_FOUND',
          message: error.message,
        });
      }
      throw error;
    }
  }

  @Post('messages')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Show a message on the reader screen (display.message)',
    description:
      'Persisted and delivered like any order: when the device is offline it is queued and sent on reconnection.',
  })
  @ApiBody({ type: SendMessageDto })
  @ApiOkResponse({ type: SendMessageResultDto })
  @ApiBadRequestResponse({
    description:
      'Invalid body, or a title/subtitle that does not fit the screen (the response names the field and the limit)',
  })
  @ApiNotFoundResponse({ description: 'No device known (NO_DEVICE)' })
  async sendMessage(
    @Body(new ZodValidationPipe(sendMessageSchema))
    body: SendMessageBody,
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
