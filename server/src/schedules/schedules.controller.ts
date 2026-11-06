import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ScheduleValidationError } from './domain/schedule.js';
import {
  CreateScheduleDto,
  ResolveResponseDto,
  ScheduleResponseDto,
  createScheduleSchema,
  resolveQuerySchema,
  toResolveResponse,
  toScheduleResponse,
} from './dto/schedule.dto.js';
import { InstancesService } from './instances.service.js';
import { ScheduleLookupFailed, SchedulesService } from './schedules.service.js';
import { ApiAuth, Roles } from '../common/auth/roles.decorator.js';

@ApiTags('schedules')
@ApiAuth()
@Controller('schedules')
export class SchedulesController {
  constructor(
    private readonly schedules: SchedulesService,
    private readonly instances: InstancesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post()
  @Roles('admin')
  @ApiOperation({
    summary: 'Create a recurring or one-off schedule (Bogota times)',
    description:
      'Give weekday or date plus start and end, or only `endsInMinutes` for a test schedule that starts now.',
  })
  @ApiBody({ type: CreateScheduleDto })
  @ApiCreatedResponse({ type: ScheduleResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body or definition' })
  async create(
    @Body(new ZodValidationPipe(createScheduleSchema))
    body: z.infer<typeof createScheduleSchema>,
  ): Promise<ScheduleResponseDto> {
    try {
      return toScheduleResponse(await this.schedules.create(body));
    } catch (error) {
      if (error instanceof ScheduleValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'List schedules with students and upcoming dates' })
  @ApiOkResponse({ type: [ScheduleResponseDto] })
  async list(): Promise<ScheduleResponseDto[]> {
    return (await this.schedules.list()).map(toScheduleResponse);
  }

  // Declared before `:id` so that "resolve" is not read as an id.
  @Get('resolve')
  @ApiOperation({
    summary: 'Schedule that applies to a student at an instant (default: now)',
  })
  @ApiQuery({ name: 'studentId', format: 'uuid' })
  @ApiQuery({ name: 'at', required: false, description: 'ISO-8601 instant' })
  @ApiOkResponse({ type: ResolveResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid query' })
  async resolve(
    @Query(new ZodValidationPipe(resolveQuerySchema))
    query: z.infer<typeof resolveQuerySchema>,
  ): Promise<ResolveResponseDto> {
    const at = query.at ? new Date(query.at) : this.clock.now();
    return toResolveResponse(
      await this.instances.resolveForStudent(query.studentId, at),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'A schedule with its students and upcoming dates' })
  @ApiOkResponse({ type: ScheduleResponseDto })
  @ApiNotFoundResponse({ description: 'Schedule not found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ScheduleResponseDto> {
    const detail = await this.schedules.get(id);
    if (!detail) throw new NotFoundException('Schedule not found');
    return toScheduleResponse(detail);
  }

  @Put(':id/students/:studentId')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Assign a student (idempotent)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Schedule or student not found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ): Promise<void> {
    await this.orNotFound(() => this.schedules.assignStudent(id, studentId));
  }

  @Delete(':id/students/:studentId')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a student from a schedule (idempotent)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Schedule or student not found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  async unassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ): Promise<void> {
    await this.orNotFound(() => this.schedules.unassignStudent(id, studentId));
  }

  private async orNotFound(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (error instanceof ScheduleLookupFailed) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
