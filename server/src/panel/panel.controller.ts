import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { ApiAuth } from '../common/auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  PanelFingerprintsDto,
  PanelNowDto,
  RosterDto,
  rosterQuerySchema,
} from './dto/panel.dto.js';
import { PanelScheduleNotFoundError, PanelService } from './panel.service.js';

/** Read models for the assistant's screens. Any signed-in role may read them. */
@ApiTags('panel')
@ApiAuth()
@Controller('panel')
export class PanelController {
  constructor(private readonly panel: PanelService) {}

  @Get('now')
  @ApiOperation({
    summary: 'Snapshot of the schedule in progress',
    description:
      'Who is inside, who left and who is missing, the time left and the alarm. `current` is null when no schedule is in progress (then `inside` lists whoever is still inside).',
  })
  @ApiOkResponse({ type: PanelNowDto })
  now(): Promise<PanelNowDto> {
    return this.panel.now();
  }

  @Get('schedules/:id/roster')
  @ApiOperation({
    summary: 'Who had to attend a schedule on a date, who did and who did not',
  })
  @ApiQuery({ name: 'date', example: '2026-11-02', description: 'Bogota day' })
  @ApiOkResponse({ type: RosterDto })
  @ApiBadRequestResponse({ description: 'Invalid id or date' })
  @ApiNotFoundResponse({ description: 'Schedule not found' })
  async roster(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(rosterQuerySchema))
    query: z.infer<typeof rosterQuerySchema>,
  ): Promise<RosterDto> {
    try {
      return await this.panel.roster(id, query.date);
    } catch (error) {
      if (error instanceof PanelScheduleNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Get('fingerprints')
  @ApiOperation({
    summary: 'Students that already have an enrolled fingerprint',
  })
  @ApiOkResponse({ type: PanelFingerprintsDto })
  async fingerprints(): Promise<PanelFingerprintsDto> {
    return { studentIds: await this.panel.studentIdsWithFingerprint() };
  }
}
