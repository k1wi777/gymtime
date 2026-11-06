import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  EnrollmentResponseDto,
  StartEnrollmentDto,
  startEnrollmentSchema,
  toEnrollmentResponse,
} from './dto/enrollment.dto.js';
import { EnrollmentError } from './enrollment.errors.js';
import { EnrollmentService } from './enrollment.service.js';
import { ApiAuth } from '../common/auth/roles.decorator.js';

@ApiTags('enrollments')
@ApiAuth()
@Controller()
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentService) {}

  @Post('students/:id/enrollments')
  @ApiOperation({ summary: 'Start the fingerprint enrollment of a student' })
  @ApiBody({ type: StartEnrollmentDto, required: false })
  @ApiCreatedResponse({ type: EnrollmentResponseDto })
  @ApiNotFoundResponse({ description: 'Student not found' })
  @ApiConflictResponse({
    description: 'Student inactive, device busy or device unavailable',
  })
  @ApiBadRequestResponse({ description: 'Invalid id or body' })
  async start(
    @Param('id', ParseUUIDPipe) studentId: string,
    @Body(new ZodValidationPipe(startEnrollmentSchema))
    body: z.infer<typeof startEnrollmentSchema>,
  ): Promise<EnrollmentResponseDto> {
    return this.run(() => this.enrollments.start(studentId, body.deviceId));
  }

  @Post('enrollments/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an open enrollment' })
  @ApiOkResponse({ type: EnrollmentResponseDto })
  @ApiNotFoundResponse({ description: 'Enrollment not found' })
  @ApiConflictResponse({ description: 'Enrollment already finished' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EnrollmentResponseDto> {
    return this.run(() => this.enrollments.cancel(id));
  }

  @Get('enrollments/:id')
  @ApiOperation({ summary: 'State of an enrollment' })
  @ApiOkResponse({ type: EnrollmentResponseDto })
  @ApiNotFoundResponse({ description: 'Enrollment not found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<EnrollmentResponseDto> {
    return this.run(() => this.enrollments.get(id));
  }

  private async run(
    action: () => ReturnType<EnrollmentService['get']>,
  ): Promise<EnrollmentResponseDto> {
    try {
      return toEnrollmentResponse(await action());
    } catch (error) {
      if (error instanceof EnrollmentError) throw toHttp(error);
      throw error;
    }
  }
}

function toHttp(error: EnrollmentError) {
  switch (error.code) {
    case 'STUDENT_NOT_FOUND':
    case 'ENROLLMENT_NOT_FOUND':
      return new NotFoundException(error.message);
    default:
      return new ConflictException(error.message);
  }
}
