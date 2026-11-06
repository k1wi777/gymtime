import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { ApiAuth, Roles } from '../../common/auth/roles.decorator.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import {
  ImportDto,
  ImportFieldDto,
  ImportResponseDto,
  PreviewDto,
  PreviewResponseDto,
  importSchema,
  previewSchema,
} from './student-import.dto.js';
import { ImportError, StudentImportService } from './student-import.service.js';

/** CSV import of students (administrator). */
@ApiTags('students')
@ApiAuth()
@Roles('admin')
@Controller('students/import')
export class StudentImportController {
  constructor(private readonly importer: StudentImportService) {}

  @Get('fields')
  @ApiOperation({
    summary: 'Student fields: key, label, required (the single definition)',
  })
  @ApiOkResponse({ type: [ImportFieldDto] })
  fields(): ImportFieldDto[] {
    return this.importer.fields();
  }

  @Get('template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="plantilla-estudiantes.csv"',
  )
  @ApiOperation({
    summary: 'CSV template with the header and two sample rows',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'The template file',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  template(): string {
    return this.importer.template();
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Read a CSV and validate it without storing anything',
    description:
      'Without `mapping`: headers, suggested mapping and sample rows. With `mapping`: also every row validated, with the errors by row and reason.',
  })
  @ApiBody({ type: PreviewDto })
  @ApiOkResponse({ type: PreviewResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid body, INVALID_CSV or MAPPING_INCOMPLETE',
  })
  async preview(
    @Body(new ZodValidationPipe(previewSchema))
    body: z.infer<typeof previewSchema>,
  ): Promise<PreviewResponseDto> {
    return this.run(() => this.importer.preview(body.content, body.mapping));
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Import the valid rows of a CSV',
    description:
      'Validates again in the server and creates only the valid rows; an existing or repeated document is a row error and never overwrites data. The students are left without consent.',
  })
  @ApiBody({ type: ImportDto })
  @ApiOkResponse({ type: ImportResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid body, INVALID_CSV or MAPPING_INCOMPLETE',
  })
  @ApiConflictResponse({ description: 'IMPORT_CONFLICT' })
  async import(
    @Body(new ZodValidationPipe(importSchema))
    body: z.infer<typeof importSchema>,
  ): Promise<ImportResponseDto> {
    return this.run(() =>
      this.importer.import(body.content, body.mapping, body.filename),
    );
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      const body = { code: error.code, message: error.message };
      throw error.code === 'IMPORT_CONFLICT'
        ? new ConflictException({ statusCode: 409, ...body })
        : new BadRequestException(body);
    }
  }
}
