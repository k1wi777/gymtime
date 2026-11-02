import {
  ConflictException,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { API_KEY_HEADER, ApiKeyGuard } from '../common/auth/api-key.guard.js';
import {
  NoDeviceOnlineError,
  SyncService,
  type SyncFailure,
  type SyncReason,
  type SyncResult,
} from './sync.service.js';

export class SyncResultDto implements SyncResult {
  @ApiProperty({ enum: ['ok', 'failed'] })
  status: 'ok' | 'failed';
  @ApiProperty({ format: 'uuid' })
  syncId: string;
  @ApiProperty()
  deviceId: string;
  @ApiProperty()
  reason: SyncReason;
  @ApiProperty({ description: 'Templates loaded into the reader' })
  templates: number;
  @ApiProperty({ description: 'Chunks acknowledged by the reader' })
  chunks: number;
  @ApiProperty({ nullable: true, type: String })
  scheduleId: string | null;
  @ApiProperty({ description: 'Students left out for lack of slots' })
  omitted: number;
  @ApiProperty({
    nullable: true,
    type: String,
    enum: ['PLAN_FAILED', 'CHUNK_FAILED'],
  })
  error: SyncFailure | null;
}

@ApiTags('sync')
@ApiHeader({ name: API_KEY_HEADER, required: true })
@ApiUnauthorizedResponse({ description: 'Missing or invalid API key' })
@UseGuards(ApiKeyGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Load the online reader with the current templates and schedule',
    description:
      'Synchronous: answers when every chunk was acknowledged or the sync failed.',
  })
  @ApiOkResponse({ type: SyncResultDto })
  @ApiConflictResponse({ description: 'No device is online' })
  async run(): Promise<SyncResultDto> {
    try {
      return await this.sync.syncOnline('manual');
    } catch (error) {
      if (error instanceof NoDeviceOnlineError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }
}
