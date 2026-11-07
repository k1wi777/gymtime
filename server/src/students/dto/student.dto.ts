import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { studentFieldSchemas } from '@gymtime/shared';
import { z } from 'zod';

const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 20;

const { document, name, program, email, phone, displayName } =
  studentFieldSchemas;

// The field list lives in `@gymtime/shared` (STUDENT_FIELDS); this is its
// REST shape. A test checks that no field of the list is missing here.
export const createStudentSchema = z.strictObject({
  document,
  name,
  program: program.nullable().optional().default(null),
  email: email.nullable().optional().default(null),
  phone: phone.nullable().optional().default(null),
  displayName: displayName.optional(),
  // Shortcut: records the consent of the current text version.
  consented: z.boolean().default(false),
});

export const updateStudentSchema = z
  .strictObject({
    name: name.optional(),
    program: program.nullable().optional(),
    email: email.nullable().optional(),
    phone: phone.nullable().optional(),
    displayName: displayName.optional(),
    // Consent can be given here but not withdrawn (that is H11).
    consented: z.literal(true).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'no fields to update');

export const listStudentsQuerySchema = z.strictObject({
  active: z.enum(['true', 'false']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  program: z.string().trim().min(1).max(200).optional(),
});

export const consentBodySchema = z.strictObject({
  version: z.string().trim().min(1).max(50),
});

/**
 * Erasure needs the current document typed back, or `reapply: true` to
 * repeat an erasure recorded before a restore (the operator then only has ids).
 */
export const eraseBodySchema = z.union([
  z.strictObject({ confirmDocument: z.string().trim().min(1).max(100) }),
  z.strictObject({ reapply: z.literal(true) }),
]);

export class EraseStudentDto {
  @ApiPropertyOptional({
    description: 'The current document of the student, to confirm',
  })
  confirmDocument?: string;
  @ApiPropertyOptional({
    description:
      'Re-apply an erasure after restoring a backup (no document needed)',
  })
  reapply?: true;
}

export class EraseResultDto {
  @ApiProperty({ format: 'uuid' })
  studentId: string;
  @ApiProperty({ description: 'Templates deleted by this call' })
  templatesDeleted: number;
}

export class CreateStudentDto {
  @ApiProperty({ description: 'Unique identity document' })
  document: string;
  @ApiProperty()
  name: string;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Degree of the student (carrera)',
  })
  program?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: MAX_EMAIL_LENGTH,
    description: 'Optional contact email (valid format)',
  })
  email?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: MAX_PHONE_LENGTH,
    description: 'Optional phone: digits, spaces, +, - and parentheses',
  })
  phone?: string | null;
  @ApiPropertyOptional({
    description:
      'Name drawn on the reader LCD (ASCII, up to DISPLAY_COLS); generated from the name when omitted',
  })
  displayName?: string;
  @ApiPropertyOptional({
    default: false,
    description:
      'Shortcut: records the consent of the current text version (see GET /students/consent)',
  })
  consented?: boolean;
}

export class UpdateStudentDto {
  @ApiPropertyOptional()
  name?: string;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Degree of the student (carrera)',
  })
  program?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: MAX_EMAIL_LENGTH,
  })
  email?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: MAX_PHONE_LENGTH,
  })
  phone?: string | null;
  @ApiPropertyOptional({
    description: 'Name drawn on the reader LCD (ASCII, up to DISPLAY_COLS)',
  })
  displayName?: string;
  @ApiPropertyOptional({
    enum: [true],
    description:
      'true records the consent of the current text version; false is rejected (withdrawal is a later work item)',
  })
  consented?: true;
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
  @ApiProperty({ description: 'True while a consent is recorded' })
  consented: boolean;
  @ApiProperty({ nullable: true, type: String })
  consentVersion: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  consentAt: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'Set when the personal data was erased (Ley 1581)',
  })
  anonymizedAt: string | null;
}

export class ConsentTextDto {
  @ApiProperty({ example: 'v1-provisional' })
  version: string;
  @ApiProperty({ description: 'Text to read to the student before consenting' })
  text: string;
}

export class RecordConsentDto {
  @ApiProperty({
    example: 'v1-provisional',
    description: 'Version shown to the student; must be the current one',
  })
  version: string;
}
