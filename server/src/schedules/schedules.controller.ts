import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
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
import {
  AssignStudentDto,
  BulkAssignDto,
  BulkAssignResponseDto,
  CopyStudentsDto,
  CopyStudentsResponseDto,
  CreateScheduleDto,
  ResolveResponseDto,
  ScheduleResponseDto,
  UpdateScheduleDto,
  assignBodySchema,
  bulkAssignSchema,
  copyStudentsSchema,
  createScheduleSchema,
  resolveQuerySchema,
  toBulkAssignResponse,
  toCopyResponse,
  toResolveResponse,
  toScheduleResponse,
  updateScheduleSchema,
} from './dto/schedule.dto.js';
import { mapScheduleError } from './http-errors.js';
import { InstancesService } from './instances.service.js';
import { SchedulesService } from './schedules.service.js';
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
      'A recurring schedule (`weekday`) needs a `periodId` and gets all its occurrences for the whole period, skipping the days without service (see `regeneration`). A one-off schedule (`date`) or the quick form (`endsInMinutes`, a test schedule that starts now) does not depend on any period.',
  })
  @ApiBody({ type: CreateScheduleDto })
  @ApiCreatedResponse({ type: ScheduleResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body or definition' })
  @ApiConflictResponse({
    description:
      'SCHEDULE_OVERLAP: overlaps another schedule of the period and day',
  })
  async create(
    @Body(new ZodValidationPipe(createScheduleSchema))
    body: z.infer<typeof createScheduleSchema>,
  ): Promise<ScheduleResponseDto> {
    return this.orMapped(async () =>
      toScheduleResponse(await this.schedules.create(body)),
    );
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

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Edit a schedule and regenerate its future occurrences',
    description:
      'Only future occurrences without attendance or alarms change; the others are kept (see `regeneration`).',
  })
  @ApiBody({ type: UpdateScheduleDto })
  @ApiOkResponse({ type: ScheduleResponseDto })
  @ApiNotFoundResponse({ description: 'Schedule not found' })
  @ApiBadRequestResponse({ description: 'Invalid body or definition' })
  @ApiConflictResponse({ description: 'SCHEDULE_OVERLAP' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateScheduleSchema))
    body: z.infer<typeof updateScheduleSchema>,
  ): Promise<ScheduleResponseDto> {
    return this.orMapped(async () =>
      toScheduleResponse(await this.schedules.update(id, body)),
    );
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a schedule without history',
    description:
      'Rejected with SCHEDULE_HAS_ATTENDANCE when any of its occurrences has attendance or alarms: the history is kept.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Schedule not found' })
  @ApiConflictResponse({ description: 'SCHEDULE_HAS_ATTENDANCE' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.orMapped(() => this.schedules.remove(id));
  }

  @Put(':id/students/:studentId')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Assign a student (idempotent), optionally from a date',
  })
  @ApiBody({ type: AssignStudentDto, required: false })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Schedule or student not found' })
  @ApiBadRequestResponse({
    description: 'Invalid id or `validFrom` in the past',
  })
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body(new ZodValidationPipe(assignBodySchema))
    body: z.infer<typeof assignBodySchema>,
  ): Promise<void> {
    await this.orMapped(() =>
      this.schedules.assignStudent(
        id,
        studentId,
        body.validFrom ? new Date(body.validFrom) : undefined,
      ),
    );
  }

  @Post(':id/students/bulk')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Assign many students by document',
    description:
      'Assigns the active students that exist and reports apart the unknown documents, the deactivated students and those already assigned; it never aborts because of them.',
  })
  @ApiBody({ type: BulkAssignDto })
  @ApiOkResponse({ type: BulkAssignResponseDto })
  @ApiNotFoundResponse({ description: 'Schedule not found' })
  @ApiBadRequestResponse({
    description: 'Invalid body (at most 500 documents)',
  })
  async bulkAssign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(bulkAssignSchema))
    body: z.infer<typeof bulkAssignSchema>,
  ): Promise<BulkAssignResponseDto> {
    return this.orMapped(async () =>
      toBulkAssignResponse(await this.schedules.bulkAssign(id, body.documents)),
    );
  }

  @Post(':id/students/copy')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Copy the current student list of another schedule',
    description:
      'Only active students; those already assigned are not duplicated.',
  })
  @ApiBody({ type: CopyStudentsDto })
  @ApiOkResponse({ type: CopyStudentsResponseDto })
  @ApiNotFoundResponse({ description: 'Schedule not found' })
  @ApiBadRequestResponse({ description: 'Invalid body or same schedule' })
  async copyStudents(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(copyStudentsSchema))
    body: z.infer<typeof copyStudentsSchema>,
  ): Promise<CopyStudentsResponseDto> {
    return this.orMapped(async () =>
      toCopyResponse(
        await this.schedules.copyStudents(id, body.fromScheduleId),
      ),
    );
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
    await this.orMapped(() => this.schedules.unassignStudent(id, studentId));
  }

  private async orMapped<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw mapScheduleError(error);
    }
  }
}
