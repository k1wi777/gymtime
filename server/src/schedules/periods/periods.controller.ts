import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  ApiTags,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { ApiAuth, Roles } from '../../common/auth/roles.decorator.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { RegenerationDto } from '../dto/schedule.dto.js';
import { mapScheduleError } from '../http-errors.js';
import {
  CreateExceptionDto,
  CreatePeriodDto,
  ExceptionResultDto,
  PeriodResponseDto,
  UpdateExceptionDto,
  UpdatePeriodDto,
  createExceptionSchema,
  createPeriodSchema,
  toExceptionResult,
  toPeriodResponse,
  updateExceptionSchema,
  updatePeriodSchema,
} from './periods.dto.js';
import { PeriodsService } from './periods.service.js';

/** Academic periods and their days without service (E18). */
@ApiTags('periods')
@ApiAuth()
@Controller('periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  @Get()
  @ApiOperation({ summary: 'List periods with their days without service' })
  @ApiOkResponse({ type: [PeriodResponseDto] })
  async list(): Promise<PeriodResponseDto[]> {
    return (await this.periods.list()).map(toPeriodResponse);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A period with its days without service' })
  @ApiOkResponse({ type: PeriodResponseDto })
  @ApiNotFoundResponse({ description: 'PERIOD_NOT_FOUND' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PeriodResponseDto> {
    return this.run(async () => toPeriodResponse(await this.periods.get(id)));
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create a period (inactive)' })
  @ApiBody({ type: CreatePeriodDto })
  @ApiCreatedResponse({ type: PeriodResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body or INVALID_RANGE' })
  @ApiConflictResponse({
    description: 'PERIOD_OVERLAP: the message names the conflicting period',
  })
  async create(
    @Body(new ZodValidationPipe(createPeriodSchema))
    body: z.infer<typeof createPeriodSchema>,
  ): Promise<PeriodResponseDto> {
    return this.run(async () =>
      toPeriodResponse(await this.periods.create(body)),
    );
  }

  @Patch(':id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Edit a period; changing its dates regenerates the occurrences',
  })
  @ApiBody({ type: UpdatePeriodDto })
  @ApiOkResponse({ type: PeriodResponseDto })
  @ApiNotFoundResponse({ description: 'PERIOD_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'PERIOD_OVERLAP or PERIOD_EXCLUDES_EXCEPTION',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePeriodSchema))
    body: z.infer<typeof updatePeriodSchema>,
  ): Promise<PeriodResponseDto> {
    return this.run(async () =>
      toPeriodResponse(await this.periods.update(id, body)),
    );
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a period without schedules' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'PERIOD_NOT_FOUND' })
  @ApiConflictResponse({ description: 'PERIOD_HAS_SCHEDULES' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.run(() => this.periods.remove(id));
  }

  @Post(':id/activate')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Make this the only active period',
    description: 'The previously active period is deactivated.',
  })
  @ApiOkResponse({ type: PeriodResponseDto })
  @ApiNotFoundResponse({ description: 'PERIOD_NOT_FOUND' })
  @ApiConflictResponse({ description: 'PERIOD_OVERLAP' })
  async activate(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PeriodResponseDto> {
    return this.run(async () =>
      toPeriodResponse(await this.periods.activate(id)),
    );
  }

  @Post(':id/deactivate')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a period (its occurrences are kept)' })
  @ApiOkResponse({ type: PeriodResponseDto })
  @ApiNotFoundResponse({ description: 'PERIOD_NOT_FOUND' })
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PeriodResponseDto> {
    return this.run(async () =>
      toPeriodResponse(await this.periods.deactivate(id)),
    );
  }

  @Post(':id/exceptions')
  @Roles('admin')
  @ApiOperation({
    summary: 'Add days without service and regenerate the occurrences',
  })
  @ApiBody({ type: CreateExceptionDto })
  @ApiCreatedResponse({ type: ExceptionResultDto })
  @ApiNotFoundResponse({ description: 'PERIOD_NOT_FOUND' })
  @ApiBadRequestResponse({
    description: 'INVALID_RANGE or EXCEPTION_OUT_OF_PERIOD',
  })
  async addException(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createExceptionSchema))
    body: z.infer<typeof createExceptionSchema>,
  ): Promise<ExceptionResultDto> {
    return this.run(async () =>
      toExceptionResult(await this.periods.addException(id, body)),
    );
  }

  @Patch(':id/exceptions/:exceptionId')
  @Roles('admin')
  @ApiOperation({ summary: 'Edit days without service and regenerate' })
  @ApiBody({ type: UpdateExceptionDto })
  @ApiOkResponse({ type: ExceptionResultDto })
  @ApiNotFoundResponse({
    description: 'PERIOD_NOT_FOUND or EXCEPTION_NOT_FOUND',
  })
  @ApiBadRequestResponse({
    description: 'INVALID_RANGE or EXCEPTION_OUT_OF_PERIOD',
  })
  async updateException(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
    @Body(new ZodValidationPipe(updateExceptionSchema))
    body: z.infer<typeof updateExceptionSchema>,
  ): Promise<ExceptionResultDto> {
    return this.run(async () =>
      toExceptionResult(
        await this.periods.updateException(id, exceptionId, body),
      ),
    );
  }

  @Delete(':id/exceptions/:exceptionId')
  @Roles('admin')
  @ApiOperation({ summary: 'Remove days without service and regenerate' })
  @ApiOkResponse({ type: RegenerationDto })
  @ApiNotFoundResponse({
    description: 'PERIOD_NOT_FOUND or EXCEPTION_NOT_FOUND',
  })
  async removeException(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
  ): Promise<RegenerationDto> {
    return this.run(() => this.periods.removeException(id, exceptionId));
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw mapScheduleError(error);
    }
  }
}
