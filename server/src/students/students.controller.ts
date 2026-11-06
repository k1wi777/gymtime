import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
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
  CreateStudentDto,
  StudentResponseDto,
  UpdateStudentDto,
  createStudentSchema,
  listStudentsQuerySchema,
  updateStudentSchema,
} from './dto/student.dto.js';
import { StudentsService } from './students.service.js';
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
  @ApiOkResponse({ type: [StudentResponseDto] })
  list(
    @Query(new ZodValidationPipe(listStudentsQuerySchema))
    query: z.infer<typeof listStudentsQuerySchema>,
  ): Promise<Student[]> {
    const active =
      query.active === undefined ? undefined : query.active === 'true';
    return this.students.list({ active });
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
