import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { DisplayValidationError } from '../common/display/display.errors.js';
import { DuplicateDocumentError, type Student } from './domain/student.js';
import {
  ConsentTextDto,
  RecordConsentDto,
  consentBodySchema,
  CreateStudentDto,
  StudentResponseDto,
  UpdateStudentDto,
  createStudentSchema,
  listStudentsQuerySchema,
  updateStudentSchema,
} from './dto/student.dto.js';
import { CONSENT_TEXT, CONSENT_VERSION } from './consent.js';
import {
  ConsentVersionStaleError,
  StudentsService,
} from './students.service.js';
import type { z } from 'zod';
import { ApiAuth, Roles } from '../common/auth/roles.decorator.js';

@ApiTags('students')
@ApiAuth()
@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a student' })
  @ApiBody({ type: CreateStudentDto })
  @ApiCreatedResponse({ type: StudentResponseDto })
  @ApiConflictResponse({ description: 'Document already exists' })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  async create(
    @Body(new ZodValidationPipe(createStudentSchema))
    body: z.infer<typeof createStudentSchema>,
  ): Promise<Student> {
    try {
      return await this.students.create(body);
    } catch (error) {
      if (error instanceof DuplicateDocumentError) {
        throw new ConflictException(error.message);
      }
      throw mapDisplayError(error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'List students' })
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false'] })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Part of the name or of the document',
  })
  @ApiQuery({ name: 'program', required: false, description: 'Exact degree' })
  @ApiOkResponse({ type: [StudentResponseDto] })
  list(
    @Query(new ZodValidationPipe(listStudentsQuerySchema))
    query: z.infer<typeof listStudentsQuerySchema>,
  ): Promise<Student[]> {
    const active =
      query.active === undefined ? undefined : query.active === 'true';
    return this.students.list({
      active,
      search: query.search,
      program: query.program,
    });
  }

  // Declared before `:id` routes so that "consent" is not read as an id.
  @Get('consent')
  @ApiOperation({
    summary: 'Current consent text and its version',
    description:
      'The text to read to the student before recording the consent.',
  })
  @ApiOkResponse({ type: ConsentTextDto })
  consentText(): ConsentTextDto {
    return { version: CONSENT_VERSION, text: CONSENT_TEXT };
  }

  @Post(':id/consent')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record the consent of a student (version of the text shown)',
    description:
      'Idempotent for the same version. Required before enrolling a fingerprint.',
  })
  @ApiBody({ type: RecordConsentDto })
  @ApiOkResponse({ type: StudentResponseDto })
  @ApiNotFoundResponse({ description: 'Student not found' })
  @ApiConflictResponse({
    description: 'CONSENT_VERSION_STALE: the text changed since it was shown',
  })
  @ApiBadRequestResponse({ description: 'Invalid id or body' })
  async recordConsent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(consentBodySchema))
    body: z.infer<typeof consentBodySchema>,
  ): Promise<Student> {
    try {
      return this.orNotFound(
        await this.students.recordConsent(id, body.version),
      );
    } catch (error) {
      if (error instanceof ConsentVersionStaleError) {
        throw new ConflictException({
          statusCode: 409,
          code: 'CONSENT_VERSION_STALE',
          message: error.message,
          currentVersion: error.current,
        });
      }
      throw error;
    }
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit name, program (carrera), email, phone, display name or consent (not the document)',
  })
  @ApiBody({ type: UpdateStudentDto })
  @ApiOkResponse({ type: StudentResponseDto })
  @ApiNotFoundResponse({ description: 'Student not found' })
  @ApiBadRequestResponse({ description: 'Invalid id or body' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStudentSchema))
    body: z.infer<typeof updateStudentSchema>,
  ): Promise<Student> {
    try {
      return this.orNotFound(await this.students.update(id, body));
    } catch (error) {
      throw mapDisplayError(error);
    }
  }

  @Delete(':id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Deactivate a student (logical); removes its fingerprint',
  })
  @ApiOkResponse({ type: StudentResponseDto })
  @ApiNotFoundResponse({ description: 'Student not found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<Student> {
    return this.orNotFound(await this.students.deactivate(id));
  }

  private orNotFound(student: Student | null): Student {
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }
}

function mapDisplayError(error: unknown): unknown {
  if (!(error instanceof DisplayValidationError)) return error;
  return new BadRequestException({
    message: error.message,
    issues: error.errors,
  });
}
