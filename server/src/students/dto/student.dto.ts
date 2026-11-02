import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const text = z.string().trim().min(1).max(200);

export const createStudentSchema = z.strictObject({
  document: text,
  name: text,
  program: text.nullable().optional().default(null),
  consented: z.boolean().default(false),
});

export const updateStudentSchema = z
  .strictObject({
    name: text.optional(),
    program: text.nullable().optional(),
    consented: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'no fields to update');

export const listStudentsQuerySchema = z.strictObject({
  active: z.enum(['true', 'false']).optional(),
});

export class CreateStudentDto {
  @ApiProperty({ description: 'Unique identity document' })
  document: string;
  @ApiProperty()
  name: string;
  @ApiPropertyOptional({ nullable: true })
  program?: string | null;
  @ApiPropertyOptional({ default: false, description: 'Data-use consent' })
  consented?: boolean;
}

export class UpdateStudentDto {
  @ApiPropertyOptional()
  name?: string;
  @ApiPropertyOptional({ nullable: true })
  program?: string | null;
  @ApiPropertyOptional()
  consented?: boolean;
}

export class StudentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  document: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ nullable: true, type: String })
  program: string | null;
  @ApiProperty()
  active: boolean;
  @ApiProperty()
  consented: boolean;
}
