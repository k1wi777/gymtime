import type { AttendanceSource } from '../../attendance/domain/attendance-session.js';
import { ATTENDANCE_SOURCES } from '../../attendance/dto/attendance.dto.js';
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { StudentResponseDto } from '../../students/dto/student.dto.js';
import { fromBogota, toBogotaParts } from '../../common/time/bogota.js';

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (value: string): boolean =>
  DATE_SHAPE.test(value) &&
  toBogotaParts(fromBogota(value, '00:00')).date === value;
const day = z.string().refine(isRealDate, 'expected a real date as YYYY-MM-DD');
const instant = z.iso.datetime({ offset: true });
const limit = (max: number) =>
  z.coerce.number().int().min(1).max(max).default(50);
const offset = z.coerce.number().int().min(0).default(0);

export const panelStudentsQuerySchema = z.strictObject({
  search: z.string().trim().min(1).max(100).optional(),
  active: z.enum(['true', 'false']).optional(),
  program: z.string().trim().min(1).max(200).optional(),
  fingerprint: z.enum(['none', 'enrolled']).optional(),
  limit: limit(200),
  offset,
});

export const weekQuerySchema = z.strictObject({
  periodId: z.uuid().optional(),
  weekStart: day.optional(),
});

export const attendanceHistoryQuerySchema = z.strictObject({
  from: instant.optional(),
  to: instant.optional(),
  scheduleId: z.uuid().optional(),
  studentId: z.uuid().optional(),
  source: z.enum(ATTENDANCE_SOURCES).optional(),
  status: z.enum(['abierta', 'cerrada', 'no_registrada']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: limit(200),
  offset,
});

export const auditQuerySchema = z.strictObject({
  type: z.string().trim().min(1).max(100).optional(),
  actorId: z.string().trim().min(1).max(100).optional(),
  from: instant.optional(),
  to: instant.optional(),
  limit: limit(200),
  before: z.coerce.number().int().min(1).optional(),
});

export const ordersQuerySchema = z.strictObject({
  from: instant.optional(),
  to: instant.optional(),
  limit: limit(200),
  before: z.coerce.number().int().min(1).optional(),
});

export const alarmsQuerySchema = z.strictObject({
  from: instant.optional(),
  to: instant.optional(),
  limit: limit(200),
  offset,
});

export class PanelStudentDto extends StudentResponseDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  fingerprintEnrolledAt: string | null;
}

export class PanelStudentsDto {
  @ApiProperty({ type: [PanelStudentDto] })
  items: PanelStudentDto[];
  @ApiProperty({ description: 'Matches before pagination' })
  total: number;
}

export class WeekPeriodDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ example: '2026-08-03' })
  startDate: string;
  @ApiProperty({ example: '2026-11-27' })
  endDate: string;
  @ApiProperty()
  active: boolean;
}

export class WeekDayDto {
  @ApiProperty({ example: '2026-11-02' })
  date: string;
  @ApiProperty({ minimum: 1, maximum: 7 })
  weekday: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Reason when the day is without service, otherwise null',
  })
  closedReason: string | null;
}

export class WeekScheduleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ minimum: 1, maximum: 7 })
  weekday: number;
  @ApiProperty({ example: '18:00:00' })
  startTime: string;
  @ApiProperty({ example: '19:00:00' })
  endTime: string;
  @ApiProperty({ description: 'Students assigned right now' })
  assignedCount: number;
}

export class WeekDto {
  @ApiProperty({ type: WeekPeriodDto, nullable: true })
  period: WeekPeriodDto | null;
  @ApiProperty({ example: '2026-11-02', description: 'Monday of the week' })
  weekStart: string;
  @ApiProperty({ type: [WeekDayDto] })
  days: WeekDayDto[];
  @ApiProperty({ type: [WeekScheduleDto] })
  schedules: WeekScheduleDto[];
}

export class HistoryStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  document: string;
  @ApiProperty()
  name: string;
}

export class HistoryScheduleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
}

export class HistoryActorDto {
  @ApiProperty({ enum: ['user', 'system', 'device'] })
  type: 'user' | 'system' | 'device';
  @ApiProperty({ type: String, nullable: true })
  id: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Account name when the actor is a panel user that still exists',
  })
  name: string | null;
}

export class AttendanceHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty({ type: HistoryStudentDto })
  student: HistoryStudentDto;
  @ApiProperty({ type: HistoryScheduleDto })
  schedule: HistoryScheduleDto;
  @ApiProperty({ format: 'date-time' })
  startsAt: string;
  @ApiProperty({ format: 'date-time' })
  enteredAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  exitedAt: string | null;
  @ApiProperty({ enum: ATTENDANCE_SOURCES })
  entrySource: AttendanceSource;
  @ApiProperty({ enum: ATTENDANCE_SOURCES, nullable: true })
  exitSource: AttendanceSource | null;
  @ApiProperty({ enum: ['abierta', 'cerrada', 'no_registrada'] })
  status: 'abierta' | 'cerrada' | 'no_registrada';
  @ApiProperty({ type: String, nullable: true })
  manualReason: string | null;
  @ApiProperty({
    type: HistoryActorDto,
    nullable: true,
    description: 'Who registered the entry by hand (null when by fingerprint)',
  })
  entryBy: HistoryActorDto | null;
  @ApiProperty({
    type: HistoryActorDto,
    nullable: true,
    description: 'Who registered the exit by hand (null when by fingerprint)',
  })
  exitBy: HistoryActorDto | null;
}

export class AttendanceHistoryDto {
  @ApiProperty({ type: [AttendanceHistoryItemDto] })
  items: AttendanceHistoryItemDto[];
  @ApiProperty()
  total: number;
}

export class AuditItemDto {
  @ApiProperty()
  id: number;
  @ApiProperty({ example: 'student.created' })
  type: string;
  @ApiProperty({ format: 'date-time' })
  createdAt: string;
  @ApiProperty({ type: HistoryActorDto })
  actor: HistoryActorDto;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Ids, counts and field names; never biometric data, credentials or contact data',
  })
  detail: Record<string, unknown> | null;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditItemDto] })
  items: AuditItemDto[];
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Pass as `before` to get the next (older) page; null at the end',
  })
  nextBefore: number | null;
}

export class OrderItemDto {
  @ApiProperty()
  id: number;
  @ApiProperty({
    example: 'alarm.manual_on',
    description:
      'display.message_sent, alarm.manual_on, alarm.manual_off, alarm.button_off or sync.triggered',
  })
  type: string;
  @ApiProperty({ format: 'date-time' })
  createdAt: string;
  @ApiProperty({ type: HistoryActorDto })
  actor: HistoryActorDto;
  @ApiProperty({ type: String, nullable: true })
  deviceId: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Result: delivery status of a message or sync status',
  })
  status: string | null;
  @ApiProperty({ type: Number, nullable: true })
  sessionsClosed: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Text of a message sent to the screen',
  })
  text: string | null;
}

export class OrdersPageDto {
  @ApiProperty({ type: [OrderItemDto] })
  items: OrderItemDto[];
  @ApiProperty({ type: Number, nullable: true })
  nextBefore: number | null;
}

export class AlarmHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty({ type: HistoryScheduleDto, nullable: true })
  schedule: HistoryScheduleDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  scheduleStartsAt: string | null;
  @ApiProperty({ format: 'date-time' })
  startedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endedAt: string | null;
  @ApiProperty({
    enum: ['all_exited', 'button', 'cli', 'timeout'],
    nullable: true,
  })
  closedBy: 'all_exited' | 'button' | 'cli' | 'timeout' | null;
  @ApiProperty()
  closedSessions: number;
  @ApiProperty({
    enum: ['server', 'local'],
    description:
      'local = sounded by the reader itself while offline (history only)',
  })
  origin: 'server' | 'local';
  @ApiProperty({
    type: HistoryActorDto,
    nullable: true,
    description:
      'Who silenced it: the audit event closest in time (manual or button)',
  })
  closedByActor: HistoryActorDto | null;
}

export class AlarmHistoryDto {
  @ApiProperty({ type: [AlarmHistoryItemDto] })
  items: AlarmHistoryItemDto[];
  @ApiProperty()
  total: number;
}
