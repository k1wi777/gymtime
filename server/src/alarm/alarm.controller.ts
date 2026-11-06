import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AlarmError } from './domain/alarm.errors.js';
import { AlarmService } from './alarm.service.js';
import {
  AlarmOffResultDto,
  AlarmStatusDto,
  toAlarmOffResultDto,
  toAlarmStatusDto,
} from './dto/alarm.dto.js';
import { ApiAuth } from '../common/auth/roles.decorator.js';

@ApiTags('alarm')
@ApiAuth()
@Controller('alarm')
export class AlarmController {
  constructor(private readonly alarm: AlarmService) {}

  @Get('status')
  @ApiOperation({ summary: 'Current siren state and open sessions' })
  @ApiOkResponse({ type: AlarmStatusDto })
  async status(): Promise<AlarmStatusDto> {
    return toAlarmStatusDto(await this.alarm.status());
  }

  @Post('on')
  @HttpCode(200)
  @ApiOperation({ summary: 'Turn the siren on continuously (reason MANUAL)' })
  @ApiOkResponse({ type: AlarmStatusDto })
  @ApiConflictResponse({
    description: 'No device online; body carries the code',
  })
  on(): Promise<AlarmStatusDto> {
    return this.run(() => this.alarm.turnOn('MANUAL'));
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sound the short test beep (reason TEST)' })
  @ApiOkResponse({ type: AlarmStatusDto })
  @ApiConflictResponse({
    description: 'No device online; body carries the code',
  })
  test(): Promise<AlarmStatusDto> {
    return this.run(() => this.alarm.turnOn('TEST'));
  }

  @Post('off')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Silence the siren and mark the open sessions no_registrada',
  })
  @ApiOkResponse({ type: AlarmOffResultDto })
  @ApiConflictResponse({ description: 'Alarm not on; body carries the code' })
  async off(): Promise<AlarmOffResultDto> {
    try {
      return toAlarmOffResultDto(await this.alarm.off('cli'));
    } catch (error) {
      throw this.map(error);
    }
  }

  private async run(
    action: () => Promise<Awaited<ReturnType<AlarmService['status']>>>,
  ): Promise<AlarmStatusDto> {
    try {
      return toAlarmStatusDto(await action());
    } catch (error) {
      throw this.map(error);
    }
  }

  private map(error: unknown): unknown {
    if (!(error instanceof AlarmError)) return error;
    return new ConflictException({ code: error.code, message: error.message });
  }
}
