import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { ApiAuth } from '../common/auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { DevicesService } from '../devices/devices.service.js';
import {
  DeviceClockDto,
  ResolveReviewDto,
  ReviewCountDto,
  ReviewItemDto,
  ReviewPageDto,
  VIEW_OUTCOMES,
  resolveSchema,
  reviewQuerySchema,
  toReviewItemDto,
} from './dto/offline.dto.js';
import { OfflineReviewService } from './offline-review.service.js';

/**
 * Offline events that wait for a person (E26-8) and the clock of the readers.
 * Both roles (assistant and administrator) and the admin API key can use it:
 * it is daily operation, like the manual registrations.
 */
@ApiTags('offline')
@ApiAuth()
@Controller('offline')
export class OfflineController {
  constructor(
    private readonly review: OfflineReviewService,
    private readonly devices: DevicesService,
  ) {}

  @Get('review')
  @ApiOperation({
    summary: 'Offline events by state: pending, resolved or discarded',
  })
  @ApiQuery({
    name: 'view',
    required: false,
    enum: ['pending', 'resolved', 'discarded', 'all'],
  })
  @ApiQuery({ name: 'from', required: false, format: 'date-time' })
  @ApiQuery({ name: 'to', required: false, format: 'date-time' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 200 })
  @ApiQuery({ name: 'offset', required: false, minimum: 0 })
  @ApiOkResponse({ type: ReviewPageDto })
  @ApiBadRequestResponse({ description: 'Invalid query' })
  async list(
    @Query(new ZodValidationPipe(reviewQuerySchema))
    query: z.infer<typeof reviewQuerySchema>,
  ): Promise<ReviewPageDto> {
    const { items, total } = await this.review.list({
      outcomes: VIEW_OUTCOMES[query.view],
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
    });
    return { items: items.map(toReviewItemDto), total };
  }

  @Get('review/count')
  @ApiOperation({ summary: 'How many offline events wait for a person' })
  @ApiOkResponse({ type: ReviewCountDto })
  async count(): Promise<ReviewCountDto> {
    return { pending: await this.review.count() };
  }

  @Post('review/:id/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve, correct the hour or discard a pending offline event',
    description:
      'The reason is mandatory and goes to the audit trail with the user. Correcting is limited to the same day of the event.',
  })
  @ApiBody({ type: ResolveReviewDto })
  @ApiOkResponse({ type: ReviewItemDto })
  @ApiBadRequestResponse({ description: 'Invalid body or correction' })
  @ApiNotFoundResponse({ description: 'EVENT_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'ALREADY_RESOLVED, NOT_APPROVABLE, NOT_CORRECTABLE, NO_OCCURRENCE, SESSION_ALREADY_OPEN, NO_OPEN_SESSION, INCONSISTENT_TIME',
  })
  @ApiUnprocessableEntityResponse({
    description: 'STILL_CONFLICT: the corrected hour still conflicts',
  })
  async resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(resolveSchema))
    body: z.infer<typeof resolveSchema>,
  ): Promise<ReviewItemDto> {
    const item = await this.review.resolve(id, {
      action: body.action,
      reason: body.reason,
      ts: body.ts ? new Date(body.ts) : undefined,
    });
    return toReviewItemDto(item);
  }

  @Get('clock')
  @ApiOperation({ summary: 'Capabilities and clock offset of each reader' })
  @ApiOkResponse({ type: [DeviceClockDto] })
  clock(): Promise<DeviceClockDto[]> {
    return this.devices.listClockStatus();
  }
}
