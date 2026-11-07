import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { fromBogota, toBogotaParts } from '../common/time/bogota.js';
import { COLUMN_TYPES, type ColumnType } from './domain/table.js';

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const day = z
  .string()
  .refine(
    (v) =>
      DATE_SHAPE.test(v) && toBogotaParts(fromBogota(v, '00:00')).date === v,
    'expected a real date as YYYY-MM-DD',
  );

export const REPORT_KINDS = [
  'flow',
  'attendance',
  'stay',
  'late',
  'alarms',
  'quality',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const filters = {
  from: day.optional(),
  to: day.optional(),
  scheduleId: z.uuid().optional(),
  program: z.string().trim().min(1).max(200).optional(),
  studentId: z.uuid().optional(),
};
const order = {
  sort: z.string().trim().min(1).max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
};
const groupBy = z.enum(['student', 'schedule', 'month']).default('student');
const lateGroupBy = z.enum(['student', 'schedule']).default('student');
const top = z.coerce.number().int().min(1).max(10).default(3);

/** One strict schema per report: a filter that does not apply is a 400. */
export const REPORT_QUERIES = {
  flow: z.strictObject({ ...filters, ...order, top }),
  attendance: z.strictObject({ ...filters, ...order, groupBy }),
  stay: z.strictObject({ ...filters, ...order, groupBy }),
  late: z.strictObject({ ...filters, ...order, groupBy: lateGroupBy }),
  // Alarms belong to the occurrence, not to a person.
  alarms: z.strictObject({
    from: filters.from,
    to: filters.to,
    scheduleId: filters.scheduleId,
    ...order,
  }),
  quality: z.strictObject({ ...filters, ...order }),
} as const;

export const detailQuerySchema = z.strictObject({
  from: filters.from,
  to: filters.to,
  scheduleId: filters.scheduleId,
  ...order,
});

export const optionsQuerySchema = z.strictObject({});
export const idParamSchema = z.uuid();
export const kindParamSchema = z.enum(REPORT_KINDS);

export class ReportColumnDto {
  @ApiProperty({ example: 'obligations' })
  key: string;
  @ApiProperty({ example: 'Obligaciones' })
  label: string;
  @ApiProperty({ enum: COLUMN_TYPES })
  type: ColumnType;
}

export class ReportFiltersDto {
  @ApiProperty({ example: '2026-02-02', description: 'Bogota date, inclusive' })
  from: string;
  @ApiProperty({ example: '2026-05-29', description: 'Bogota date, inclusive' })
  to: string;
  @ApiPropertyOptional({ format: 'uuid' })
  scheduleId?: string;
  @ApiPropertyOptional()
  program?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  studentId?: string;
}

/** The common shape: JSON, screen and CSV all come from these columns and rows. */
export class ReportTableDto {
  @ApiProperty({ type: ReportFiltersDto })
  filters: ReportFiltersDto;
  @ApiProperty({ type: [ReportColumnDto] })
  columns: ReportColumnDto[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'One object per row keyed by column key; `id` (when present) is the row student, for the detail',
  })
  rows: Record<string, string | number | null>[];
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Totals and the definitions the report applied',
  })
  meta: Record<string, unknown>;
}

export class HourBucketDto {
  @ApiProperty({ minimum: 0, maximum: 23 })
  hour: number;
  @ApiProperty()
  count: number;
}
export class WeekdayBucketDto {
  @ApiProperty({ minimum: 1, maximum: 7 })
  weekday: number;
  @ApiProperty()
  count: number;
}
export class DateBucketDto {
  @ApiProperty({ example: '2026-03-02' })
  date: string;
  @ApiProperty()
  count: number;
}
export class PeaksDto {
  @ApiProperty({ type: [HourBucketDto] })
  hours: HourBucketDto[];
  @ApiProperty({ type: [WeekdayBucketDto] })
  weekdays: WeekdayBucketDto[];
  @ApiProperty({ type: [DateBucketDto] })
  dates: DateBucketDto[];
}

export class FlowReportDto extends ReportTableDto {
  @ApiProperty({ description: 'Entries of the range' })
  total: number;
  @ApiProperty()
  distinctStudents: number;
  @ApiProperty({ type: [HourBucketDto], description: 'All 24 Bogota hours' })
  byHour: HourBucketDto[];
  @ApiProperty({ type: [WeekdayBucketDto], description: '1 = Monday ... 7' })
  byWeekday: WeekdayBucketDto[];
  @ApiProperty({ type: PeaksDto })
  peaks: PeaksDto;
}

export class AlarmByClosureDto {
  @ApiProperty()
  all_exited: number;
  @ApiProperty()
  button: number;
  @ApiProperty()
  cli: number;
  @ApiProperty()
  timeout: number;
}

export class AlarmSummaryDto {
  @ApiProperty()
  total: number;
  @ApiProperty()
  closed: number;
  @ApiProperty({ description: 'Still without an end' })
  open: number;
  @ApiProperty({ description: 'Minutes, closed alarms only' })
  totalMinutes: number;
  @ApiProperty({ type: Number, nullable: true })
  averageMinutes: number | null;
  @ApiProperty()
  closedSessions: number;
  @ApiProperty({ type: AlarmByClosureDto })
  byClosure: AlarmByClosureDto;
  @ApiProperty({
    description:
      'Alarms sounded by the reader itself while offline (not in the other counts)',
  })
  local: number;
}

export class AlarmsReportDto extends ReportTableDto {
  @ApiProperty({ type: AlarmSummaryDto })
  summary: AlarmSummaryDto;
}

export class OptionsPeriodDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ example: '2026-02-02' })
  startDate: string;
  @ApiProperty({ example: '2026-05-29' })
  endDate: string;
}

export class OptionsScheduleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ type: Number, nullable: true })
  weekday: number | null;
  @ApiProperty({ example: '18:00:00' })
  startTime: string;
  @ApiProperty({ example: '19:00:00' })
  endTime: string;
}

export class DefaultRangeDto {
  @ApiProperty()
  from: string;
  @ApiProperty()
  to: string;
}

export class ReportOptionsDto {
  @ApiProperty({ type: [String], description: 'Distinct degrees, sorted' })
  programs: string[];
  @ApiProperty({ type: [OptionsScheduleDto] })
  schedules: OptionsScheduleDto[];
  @ApiProperty({ type: OptionsPeriodDto, nullable: true })
  period: OptionsPeriodDto | null;
  @ApiProperty({ type: DefaultRangeDto })
  defaultRange: DefaultRangeDto;
  @ApiProperty({ example: 366 })
  maxRangeDays: number;
}

export class SummaryDayDto {
  @ApiProperty({ description: 'Entries of the occurrences in the range' })
  entries: number;
  @ApiProperty({ description: 'Students owed at occurrences already ended' })
  obligations: number;
  @ApiProperty()
  attended: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: '0-100, null without obligations',
  })
  compliance: number | null;
}

export class SummaryTodayDto extends SummaryDayDto {
  @ApiProperty({ description: 'People inside right now' })
  inside: number;
}

export class SummaryPeriodDto extends SummaryDayDto {
  @ApiProperty()
  name: string;
  @ApiProperty()
  startDate: string;
  @ApiProperty()
  endDate: string;
}

export class SummaryDeviceDto {
  @ApiProperty({ description: 'A device has connected at least once' })
  known: boolean;
  @ApiProperty()
  online: boolean;
}

export class SummaryAlertsDto {
  @ApiProperty()
  alarmOn: boolean;
  @ApiProperty({ type: SummaryDeviceDto })
  device: SummaryDeviceDto;
  @ApiProperty({ description: 'Sessions still open in occurrences that ended' })
  staleOpen: number;
  @ApiProperty({ description: '`no_registrada` sessions of the last 7 days' })
  unregistered7d: number;
}

export class SummaryDto {
  @ApiProperty({ example: '2026-03-04', description: 'Today in Bogota' })
  date: string;
  @ApiProperty({ example: '2026-03-02', description: 'Monday of this week' })
  weekStart: string;
  @ApiProperty({ type: SummaryTodayDto })
  today: SummaryTodayDto;
  @ApiProperty({ type: SummaryDayDto, description: 'Monday up to today' })
  week: SummaryDayDto;
  @ApiProperty({ type: SummaryPeriodDto, nullable: true })
  period: SummaryPeriodDto | null;
  @ApiProperty({ type: SummaryAlertsDto })
  alerts: SummaryAlertsDto;
}

export class ReportStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ type: String, nullable: true })
  program: string | null;
}

export class StudentDetailDto extends ReportTableDto {
  @ApiProperty({ type: ReportStudentDto })
  student: ReportStudentDto;
}
