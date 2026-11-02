import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ENROLLMENT_STATUSES,
  type Enrollment,
  type EnrollmentStatus,
} from '../domain/enrollment.js';

export const startEnrollmentSchema = z
  .strictObject({ deviceId: z.string().trim().min(1).max(100).optional() })
  .default({});

export class StartEnrollmentDto {
  @ApiPropertyOptional({
    description: 'Target device; defaults to the only online device',
  })
  deviceId?: string;
}

/** Never includes the template or its IV. */
export class EnrollmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty({ format: 'uuid' })
  studentId: string;
  @ApiProperty()
  deviceId: string;
  @ApiProperty({ enum: ENROLLMENT_STATUSES })
  status: EnrollmentStatus;
  @ApiProperty({ nullable: true, type: String })
  step: string | null;
  @ApiProperty({ nullable: true, type: String })
  failureReason: string | null;
  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}

export function toEnrollmentResponse(
  enrollment: Enrollment,
): EnrollmentResponseDto {
  return {
    id: enrollment.id,
    studentId: enrollment.studentId,
    deviceId: enrollment.deviceId,
    status: enrollment.status,
    step: enrollment.step,
    failureReason: enrollment.failureReason,
    expiresAt: enrollment.expiresAt.toISOString(),
  };
}
