import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const text = z.string().trim().min(1).max(200);

const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 20;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(MAX_EMAIL_LENGTH)
  .pipe(z.email());

// Digits, spaces, "+", "-" and parentheses, with at least one digit.
const phone = z
  .string()
  .trim()
  .max(MAX_PHONE_LENGTH)
  .regex(/^[0-9 +()-]+$/, 'only digits, spaces, +, - and parentheses')
  .regex(/[0-9]/, 'must contain at least one digit');

// The exact limit (DISPLAY_COLS) is enforced by the service.
const displayName = z.string().trim().min(1).max(40);

export const createStudentSchema = z.strictObject({
  document: text,
  name: text,
  program: text.nullable().optional().default(null),
  email: email.nullable().optional().default(null),
  phone: phone.nullable().optional().default(null),
  displayName: displayName.optional(),
  consented: z.boolean().default(false),
});

export const updateStudentSchema = z
  .strictObject({
    name: text.optional(),
    program: text.nullable().optional(),
    email: email.nullable().optional(),
    phone: phone.nullable().optional(),
    displayName: displayName.optional(),
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
  @ApiPropertyOptional({
    nullable: true,
    description: 'Degree of the student (carrera)',
  })
  program?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    maxLength: MAX_EMAIL_LENGTH,
    description: 'Optional contact email (valid format)',
  })
  email?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    maxLength: MAX_PHONE_LENGTH,
    description: 'Optional phone: digits, spaces, +, - and parentheses',
  })
  phone?: string | null;
  @ApiPropertyOptional({
    description:
      'Name drawn on the reader LCD (ASCII, up to DISPLAY_COLS); generated from the name when omitted',
  })
  displayName?: string;
  @ApiPropertyOptional({ default: false, description: 'Data-use consent' })
  consented?: boolean;
}

export class UpdateStudentDto {
  @ApiPropertyOptional()
  name?: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Degree of the student (carrera)',
  })
  program?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: MAX_EMAIL_LENGTH })
  email?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: MAX_PHONE_LENGTH })
  phone?: string | null;
  @ApiPropertyOptional({
    description: 'Name drawn on the reader LCD (ASCII, up to DISPLAY_COLS)',
  })
  displayName?: string;
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
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Degree (carrera)',
  })
  program: string | null;
  @ApiProperty({ nullable: true, type: String })
  email: string | null;
  @ApiProperty({ nullable: true, type: String })
  phone: string | null;
  @ApiProperty({ description: 'Name drawn on the reader LCD' })
  displayName: string;
  @ApiProperty()
  active: boolean;
  @ApiProperty()
  consented: boolean;
}
