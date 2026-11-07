import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import type {
  OpenSessionView,
  SessionInstanceView,
  SessionStudentView,
  SessionView,
} from '../attendance.service.js';
import type {
  AttendanceSource,
  SessionStatus,
} from '../domain/attendance-session.js';

export const SESSION_STATUSES = [
  'abierta',
  'cerrada',
  'no_registrada',
] as const;
export const ATTENDANCE_SOURCES = ['device', 'manual', 'offline'] as const;

export const manualAttendanceSchema = z.strictObject({
  studentId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

export const sessionQuerySchema = z.strictObject({
  studentId: z.uuid().optional(),
  instanceId: z.uuid().optional(),
  status: z.enum(SESSION_STATUSES).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export class ManualAttendanceDto {
  @ApiProperty({ format: 'uuid' })
  studentId: string;
  @ApiProperty({ description: 'Mandatory reason of the manual registration' })
  reason: string;
}

export class SessionStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  document: string;
  @ApiProperty()
  name: string;
}

export class SessionInstanceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty({ format: 'uuid' })
  scheduleId: string;
  @ApiProperty({ format: 'date-time' })
  startsAt: string;
  @ApiProperty({ format: 'date-time' })
  endsAt: string;
}

export class OpenSessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty({ type: SessionStudentDto })
  student: SessionStudentDto;
  @ApiProperty({ format: 'date-time' })
  enteredAt: string;
  @ApiProperty({ type: SessionInstanceDto })
  instance: SessionInstanceDto;
}

export class SessionDto extends OpenSessionDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  exitedAt: string | null;
  @ApiProperty({ enum: ATTENDANCE_SOURCES })
  entrySource: AttendanceSource;
  @ApiProperty({ enum: ATTENDANCE_SOURCES, nullable: true })
  exitSource: AttendanceSource | null;
  @ApiProperty({ enum: SESSION_STATUSES })
  status: SessionStatus;
  @ApiProperty({ nullable: true, type: String })
  manualReason: string | null;
}

export class SessionQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  studentId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  instanceId?: string;
  @ApiPropertyOptional({ enum: SESSION_STATUSES })
  status?: SessionStatus;
  @ApiPropertyOptional({ format: 'date-time' })
  from?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  to?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  limit?: number;
}

const toStudent = (student: SessionStudentView): SessionStudentDto => ({
  id: student.id,
  document: student.document,
  name: student.name,
});

const toInstance = (instance: SessionInstanceView): SessionInstanceDto => ({
  id: instance.id,
  scheduleId: instance.scheduleId,
  startsAt: instance.startsAt.toISOString(),
  endsAt: instance.endsAt.toISOString(),
});

export function toOpenSessionDto(view: OpenSessionView): OpenSessionDto {
  return {
    id: view.id,
    student: toStudent(view.student),
    enteredAt: view.enteredAt.toISOString(),
    instance: toInstance(view.instance),
  };
}

export function toSessionDto(view: SessionView): SessionDto {
  return {
    ...toOpenSessionDto(view),
    exitedAt: view.exitedAt?.toISOString() ?? null,
    entrySource: view.entrySource,
    exitSource: view.exitSource,
    status: view.status,
    manualReason: view.manualReason,
  };
}
