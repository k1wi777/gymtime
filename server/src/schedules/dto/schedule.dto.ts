import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import type { Student } from '../../students/domain/student.js';
import { MAX_ENTRY_MARGIN_MINUTES } from '../domain/schedule.js';
import type { ScheduleInstance } from '../domain/schedule-instance.js';
import type { ResolvedOccurrence } from '../instances.service.js';
import type {
  BulkAssignResult,
  CopyResult,
  CreateScheduleInput,
  ScheduleDetail,
  UpdateScheduleInput,
} from '../schedules.service.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const time = z.string().regex(TIME, 'expected HH:mm or HH:mm:ss');
const date = z
  .string()
  .regex(DATE, 'expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'not a real date',
  });
const margin = z.number().int().min(0).max(MAX_ENTRY_MARGIN_MINUTES);

/**
 * Either a full definition (weekday or date, start, end) or the quick form
 * `endsInMinutes`. Whether exactly one of weekday/date is given is a business
 * rule checked by the service.
 */
export const createScheduleSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    weekday: z.number().int().min(1).max(7).optional(),
    date: date.optional(),
    start: time.optional(),
    end: time.optional(),
    entryOpenMinutes: margin.optional(),
    entryCloseMinutes: margin.optional(),
    periodId: z.uuid().optional(),
    endsInMinutes: z.number().int().min(1).max(1440).optional(),
  })
  .superRefine((value, ctx) => {
    const { endsInMinutes, name: _name, ...rest } = value;
    const others = Object.values(rest).some((v) => v !== undefined);
    if (endsInMinutes !== undefined && others) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsInMinutes'],
        message: 'cannot be combined with weekday, date, start, end or margins',
      });
    }
    // A recurring schedule belongs to a period; a one-off one never does.
    if (endsInMinutes === undefined && value.weekday !== undefined) {
      if (value.periodId === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['periodId'],
          message: 'a recurring schedule needs a periodId',
        });
      }
    }
    if (value.date !== undefined && value.periodId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['periodId'],
        message: 'a one-off schedule does not belong to a period',
      });
    }
    if (endsInMinutes === undefined && (!value.start || !value.end)) {
      ctx.addIssue({
        code: 'custom',
        path: ['start'],
        message: 'start and end are required unless endsInMinutes is given',
      });
    }
  })
  .transform((value): CreateScheduleInput => {
    if (value.endsInMinutes !== undefined) {
      return { name: value.name, endsInMinutes: value.endsInMinutes };
    }
    return {
      name: value.name,
      weekday: value.weekday,
      date: value.date,
      start: value.start as string,
      end: value.end as string,
      entryOpenMinutes: value.entryOpenMinutes,
      entryCloseMinutes: value.entryCloseMinutes,
      periodId: value.periodId,
    };
  });

export const updateScheduleSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    weekday: z.number().int().min(1).max(7).optional(),
    start: time.optional(),
    end: time.optional(),
    entryOpenMinutes: margin.nullable().optional(),
    entryCloseMinutes: margin.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'no fields to update')
  .transform((value): UpdateScheduleInput => value);

export const assignBodySchema = z
  .strictObject({ validFrom: z.iso.datetime({ offset: true }).optional() })
  .default({});

export const bulkAssignSchema = z.strictObject({
  documents: z.array(z.string().trim().max(200)).min(1).max(500),
});

export const copyStudentsSchema = z.strictObject({
  fromScheduleId: z.uuid(),
});

export const resolveQuerySchema = z.strictObject({
  studentId: z.uuid(),
  at: z.iso.datetime({ offset: true }).optional(),
});

export class CreateScheduleDto {
  @ApiProperty()
  name: string;
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 7,
    description: '1 = Monday ... 7 = Sunday',
  })
  weekday?: number;
  @ApiPropertyOptional({ example: '2026-11-02', description: 'Bogota date' })
  date?: string;
  @ApiPropertyOptional({ example: '18:00', description: 'Bogota time' })
  start?: string;
  @ApiPropertyOptional({ example: '19:00', description: 'Bogota time' })
  end?: string;
  @ApiPropertyOptional({
    description: 'Minutes before the start when entry opens',
  })
  entryOpenMinutes?: number;
  @ApiPropertyOptional({
    description: 'Minutes before the end when entry closes',
  })
  entryCloseMinutes?: number;
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Period of a recurring schedule (required with `weekday`, forbidden with `date`)',
  })
  periodId?: string;
  @ApiPropertyOptional({
    description:
      'Quick test schedule: today, starting now, ending in N minutes',
  })
  endsInMinutes?: number;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional()
  name?: string;
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 7,
    description: 'Recurring only',
  })
  weekday?: number;
  @ApiPropertyOptional({ example: '18:00', description: 'Bogota time' })
  start?: string;
  @ApiPropertyOptional({ example: '19:00', description: 'Bogota time' })
  end?: string;
  @ApiPropertyOptional({ nullable: true, type: Number })
  entryOpenMinutes?: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  entryCloseMinutes?: number | null;
}

export class AssignStudentDto {
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Start of the validity; now by default, never in the past',
  })
  validFrom?: string;
}

export class BulkAssignDto {
  @ApiProperty({
    type: [String],
    description: 'Student documents (at most 500)',
  })
  documents: string[];
}

export class CopyStudentsDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Schedule to copy the list from',
  })
  fromScheduleId: string;
}

export class BulkAssignedStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  document: string;
  @ApiProperty()
  name: string;
}

export class BulkAssignResponseDto {
  @ApiProperty({ type: [BulkAssignedStudentDto] })
  assigned: BulkAssignedStudentDto[];
  @ApiProperty({ type: [BulkAssignedStudentDto] })
  alreadyAssigned: BulkAssignedStudentDto[];
  @ApiProperty({ type: [BulkAssignedStudentDto] })
  inactive: BulkAssignedStudentDto[];
  @ApiProperty({ type: [String], description: 'Documents with no student' })
  notFound: string[];
}

export class CopyStudentsResponseDto {
  @ApiProperty()
  assigned: number;
  @ApiProperty()
  alreadyAssigned: number;
  @ApiProperty()
  skippedInactive: number;
}

export class ScheduleStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  document: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  active: boolean;
}

export class InstanceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty({ example: '2026-11-02' })
  date: string;
  @ApiProperty({ format: 'date-time' })
  startsAt: string;
  @ApiProperty({ format: 'date-time' })
  endsAt: string;
}

export class RegenerationDto {
  @ApiProperty({ description: 'Occurrences created' })
  created: number;
  @ApiProperty({
    description: 'Future occurrences without history that no longer apply',
  })
  deleted: number;
  @ApiProperty({ description: 'Future occurrences moved to the new hours' })
  updated: number;
  @ApiProperty({
    description:
      'Occurrences that should change but were kept (attendance, alarm or already started)',
  })
  kept: number;
}

export class ScheduleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ nullable: true, type: Number })
  weekday: number | null;
  @ApiProperty({ nullable: true, type: String })
  date: string | null;
  @ApiProperty({ example: '18:00:00' })
  startTime: string;
  @ApiProperty({ example: '19:00:00' })
  endTime: string;
  @ApiProperty({ nullable: true, type: Number })
  entryOpenMinutes: number | null;
  @ApiProperty({ nullable: true, type: Number })
  entryCloseMinutes: number | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  periodId: string | null;
  @ApiProperty({ type: [ScheduleStudentDto] })
  students: ScheduleStudentDto[];
  @ApiProperty({ type: [InstanceDto] })
  upcoming: InstanceDto[];
  @ApiPropertyOptional({
    type: RegenerationDto,
    description: 'Only on create and edit: what happened to the occurrences',
  })
  regeneration?: RegenerationDto;
}

export class ResolvedOccurrenceDto {
  @ApiProperty({ format: 'uuid' })
  scheduleId: string;
  @ApiProperty()
  scheduleName: string;
  @ApiProperty({ type: InstanceDto })
  instance: InstanceDto;
  @ApiProperty({ format: 'date-time' })
  entryOpensAt: string;
  @ApiProperty({ format: 'date-time' })
  entryClosesAt: string;
  @ApiProperty()
  entryOpen: boolean;
}

export class ResolveResponseDto {
  @ApiProperty({ type: ResolvedOccurrenceDto, nullable: true })
  occurrence: ResolvedOccurrenceDto | null;
}

const toInstanceDto = (i: ScheduleInstance): InstanceDto => ({
  id: i.id,
  date: i.date,
  startsAt: i.startsAt.toISOString(),
  endsAt: i.endsAt.toISOString(),
});

export function toScheduleResponse(
  detail: ScheduleDetail,
): ScheduleResponseDto {
  return {
    ...detail.schedule,
    students: detail.students.map(({ id, document, name, active }) => ({
      id,
      document,
      name,
      active,
    })),
    upcoming: detail.upcoming.map(toInstanceDto),
    ...(detail.regeneration && { regeneration: detail.regeneration }),
  };
}

export function toResolveResponse(
  resolved: ResolvedOccurrence | null,
): ResolveResponseDto {
  if (!resolved) return { occurrence: null };
  return {
    occurrence: {
      scheduleId: resolved.schedule.id,
      scheduleName: resolved.schedule.name,
      instance: toInstanceDto(resolved.instance),
      entryOpensAt: resolved.window.opensAt.toISOString(),
      entryClosesAt: resolved.window.closesAt.toISOString(),
      entryOpen: resolved.entryOpen,
    },
  };
}

const toBulkStudent = ({
  id,
  document,
  name,
}: Student): BulkAssignedStudentDto => ({
  id,
  document,
  name,
});

export function toBulkAssignResponse(
  result: BulkAssignResult,
): BulkAssignResponseDto {
  return {
    assigned: result.assigned.map(toBulkStudent),
    alreadyAssigned: result.alreadyAssigned.map(toBulkStudent),
    inactive: result.inactive.map(toBulkStudent),
    notFound: result.notFound,
  };
}

export const toCopyResponse = (result: CopyResult): CopyStudentsResponseDto =>
  result;
