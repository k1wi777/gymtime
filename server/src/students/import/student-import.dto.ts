import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STUDENT_FIELDS } from '@gymtime/shared';
import { z } from 'zod';

const FIELD_KEYS = STUDENT_FIELDS.map((f) => f.key) as [string, ...string[]];

const mapping = z.partialRecord(
  z.enum(FIELD_KEYS),
  z.number().int().min(0).max(200).nullable(),
);

/** The file travels as text in the JSON body (no multipart upload). */
const content = z.string().min(1).max(1_500_000);

export const previewSchema = z.strictObject({
  content,
  mapping: mapping.optional(),
});

export const importSchema = z.strictObject({
  content,
  mapping,
  filename: z.string().trim().min(1).max(200),
});

export class PreviewDto {
  @ApiProperty({ description: 'CSV text (at most 1 MB, 5000 rows)' })
  content: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'integer', nullable: true },
    description:
      'Column index of the file for each field key (see GET /students/import/fields); when given, the whole file is validated',
  })
  mapping?: Record<string, number | null>;
}

export class ImportDto {
  @ApiProperty({ description: 'CSV text (at most 1 MB, 5000 rows)' })
  content: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer', nullable: true },
    description: 'Column index of the file for each field key',
  })
  mapping: Record<string, number | null>;
  @ApiProperty({ description: 'Original file name, kept in the batch record' })
  filename: string;
}

export class ImportFieldDto {
  @ApiProperty({ example: 'document' })
  key: string;
  @ApiProperty({ example: 'Documento' })
  label: string;
  @ApiProperty()
  required: boolean;
  @ApiProperty({ description: 'False for the document: it is not editable' })
  editable: boolean;
  @ApiProperty({ type: String, nullable: true })
  help: string | null;
  @ApiProperty()
  example: string;
}

export class RowErrorDto {
  @ApiProperty({ type: String, nullable: true })
  field: string | null;
  @ApiProperty()
  message: string;
}

export class InvalidRowDto {
  @ApiProperty({ description: 'Line of the file; the header is line 1' })
  row: number;
  @ApiProperty({ type: [RowErrorDto] })
  errors: RowErrorDto[];
}

export class ValidationSummaryDto {
  @ApiProperty()
  total: number;
  @ApiProperty()
  valid: number;
  @ApiProperty({ type: [InvalidRowDto] })
  invalidRows: InvalidRowDto[];
}

export class PreviewResponseDto {
  @ApiProperty({ enum: [',', ';'] })
  delimiter: ',' | ';';
  @ApiProperty({ type: [String] })
  headers: string[];
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer', nullable: true },
    description: 'Suggested column for each field (by header name)',
  })
  suggestedMapping: Record<string, number | null>;
  @ApiProperty({
    description: 'First rows of the file',
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  })
  sample: string[][];
  @ApiPropertyOptional({ type: ValidationSummaryDto })
  validation?: ValidationSummaryDto;
}

export class ImportResponseDto {
  @ApiProperty({ format: 'uuid' })
  batchId: string;
  @ApiProperty()
  total: number;
  @ApiProperty({ description: 'Students created' })
  created: number;
  @ApiProperty({
    type: [InvalidRowDto],
    description: 'Not stored: this response is the only copy of the report',
  })
  invalidRows: InvalidRowDto[];
}
