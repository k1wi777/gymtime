import {
  BadRequestException,
  Controller,
  Get,
  applyDecorators,
  NotFoundException,
  Param,
  Query,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { ApiAuth, Roles } from '../common/auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ReportFilterError } from './domain/filters.js';
import {
  AlarmsReportDto,
  FlowReportDto,
  REPORT_KINDS,
  REPORT_QUERIES,
  ReportOptionsDto,
  ReportTableDto,
  StudentDetailDto,
  SummaryDto,
  detailQuerySchema,
  idParamSchema,
  kindParamSchema,
  type ReportKind,
} from './reports.dto.js';
import {
  ReportTooLargeError,
  ReportsService,
  type ReportQuery,
} from './reports.service.js';

const q = (name: string, extra: Record<string, unknown> = {}) =>
  ApiQuery({ name, required: false, ...extra });

/** Query parameters of every report (the range defaults to the active period). */
const common = (...extra: MethodDecorator[]) =>
  applyDecorators(
    ...extra,
    ...COMMON,
    ApiBadRequestResponse({
      description: 'Invalid filters (INVALID_RANGE, RANGE_TOO_WIDE)',
    }),
  );
const COMMON = [
  q('from', { example: '2026-02-02', description: 'Bogota date, inclusive' }),
  q('to', { example: '2026-05-29', description: 'Bogota date, inclusive' }),
  q('scheduleId', { format: 'uuid' }),
  q('program', { description: 'Exact degree, ignoring case and accents' }),
  q('studentId', { format: 'uuid' }),
  q('sort', { description: 'Column key to sort by' }),
  q('dir', { enum: ['asc', 'desc'] }),
];

/** The business failures of the reports as HTTP errors with a stable `code`. */
function mapReportError(error: unknown): unknown {
  if (error instanceof ReportFilterError) {
    return new BadRequestException({
      code: error.code,
      message: error.message,
    });
  }
  if (error instanceof ReportTooLargeError) {
    return new UnprocessableEntityException({
      code: 'REPORT_TOO_LARGE',
      message: error.message,
    });
  }
  return error;
}

async function mapped<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw mapReportError(error);
  }
}

/**
 * Reports and metrics (E23), for administrators only: they list people with
 * their absences and stay times, and the CSV takes that out of the system.
 */
@ApiTags('reports')
@ApiAuth()
@Roles('admin')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('options')
  @ApiOperation({
    summary: 'Filter options: degrees, schedules, active period, default range',
  })
  @ApiOkResponse({ type: ReportOptionsDto })
  options(): Promise<ReportOptionsDto> {
    return this.reports.options();
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Administrator summary: today, week, period and alerts',
    description:
      'Attendance counts only occurrences that already ended; the alerts are the alarm, the reader, open sessions of finished occurrences and unregistered exits of the last 7 days.',
  })
  @ApiOkResponse({ type: SummaryDto })
  summary(): Promise<SummaryDto> {
    return this.reports.summary();
  }

  @Get('flow')
  @common(
    ApiOperation({
      summary: 'Entries per hour and weekday, with the peaks',
      description:
        'Entries (not simultaneous occupancy), by the Bogota hour and weekday of the entry. The range is by the date of the occurrence.',
    }),
    q('top', { type: Number, minimum: 1, maximum: 10 }),
  )
  @ApiOkResponse({ type: FlowReportDto })
  flow(
    @Query(new ZodValidationPipe(REPORT_QUERIES.flow))
    query: z.infer<typeof REPORT_QUERIES.flow>,
  ): Promise<FlowReportDto> {
    return mapped(() => this.reports.flow(query));
  }

  @Get('attendance')
  @common(
    ApiOperation({
      summary: 'Absences and compliance',
      description:
        'Obligations (students owed at occurrences that ended, outside days without service, with a validity open at the start), attended and the percentage; null without obligations.',
    }),
    q('groupBy', { enum: ['student', 'schedule', 'month'] }),
  )
  @ApiOkResponse({ type: ReportTableDto })
  attendance(
    @Query(new ZodValidationPipe(REPORT_QUERIES.attendance))
    query: z.infer<typeof REPORT_QUERIES.attendance>,
  ): Promise<ReportTableDto> {
    return mapped(() => this.reports.attendanceReport(query));
  }

  @Get('stay')
  @common(
    ApiOperation({
      summary: 'Average stay',
      description:
        'Average of exit minus entry of the closed sessions; unregistered and open ones are counted apart.',
    }),
    q('groupBy', { enum: ['student', 'schedule', 'month'] }),
  )
  @ApiOkResponse({ type: ReportTableDto })
  stay(
    @Query(new ZodValidationPipe(REPORT_QUERIES.stay))
    query: z.infer<typeof REPORT_QUERIES.stay>,
  ): Promise<ReportTableDto> {
    return mapped(() => this.reports.stay(query));
  }

  @Get('late')
  @common(
    ApiOperation({
      summary: 'Late arrivals',
      description:
        'Fingerprint entries at least one full minute after the start; manual entries are counted apart.',
    }),
    q('groupBy', { enum: ['student', 'schedule'] }),
  )
  @ApiOkResponse({ type: ReportTableDto })
  late(
    @Query(new ZodValidationPipe(REPORT_QUERIES.late))
    query: z.infer<typeof REPORT_QUERIES.late>,
  ): Promise<ReportTableDto> {
    return mapped(() => this.reports.late(query));
  }

  @Get('alarms')
  @ApiOperation({
    summary: 'Alarms of the range',
    description:
      'One row per alarm and a summary by way of closure; the student and degree filters do not apply (400).',
  })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'scheduleId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'sort', required: false })
  @ApiQuery({ name: 'dir', required: false, enum: ['asc', 'desc'] })
  @ApiOkResponse({ type: AlarmsReportDto })
  @ApiBadRequestResponse({ description: 'Invalid filters or range' })
  alarms(
    @Query(new ZodValidationPipe(REPORT_QUERIES.alarms))
    query: z.infer<typeof REPORT_QUERIES.alarms>,
  ): Promise<AlarmsReportDto> {
    return mapped(() => this.reports.alarms(query)) as Promise<AlarmsReportDto>;
  }

  @Get('quality')
  @common(
    ApiOperation({
      summary: 'Data quality',
      description:
        'Sessions with a manual entry or exit, unregistered, and open ones in finished occurrences. `meta.estados` lists the states counted.',
    }),
  )
  @ApiOkResponse({ type: ReportTableDto })
  quality(
    @Query(new ZodValidationPipe(REPORT_QUERIES.quality))
    query: z.infer<typeof REPORT_QUERIES.quality>,
  ): Promise<ReportTableDto> {
    return mapped(() => this.reports.quality(query));
  }

  @Get('students/:id')
  @ApiOperation({
    summary: 'Detail of one student',
    description:
      'Every occurrence the student owed in the range, with the result, entry, exit, delay and stay.',
  })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'scheduleId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'sort', required: false })
  @ApiQuery({ name: 'dir', required: false, enum: ['asc', 'desc'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StudentDetailDto })
  @ApiBadRequestResponse({ description: 'Invalid filters or range' })
  @ApiNotFoundResponse({ description: 'The student does not exist' })
  async studentDetail(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Query(new ZodValidationPipe(detailQuerySchema))
    query: z.infer<typeof detailQuerySchema>,
  ): Promise<StudentDetailDto> {
    const detail = await mapped(() => this.reports.studentDetail(id, query));
    if (!detail) throw new NotFoundException('El estudiante no existe');
    return detail;
  }

  @Get(':kind/export')
  @common(
    ApiOperation({
      summary: 'Export a report as CSV (audited)',
      description:
        'UTF-8 with BOM, `;` separator, decimal comma, Bogota dates, same columns, filters and order as the JSON. Contains personal data: it is written to the audit trail (`report.exported`) before the file is delivered.',
    }),
    q('groupBy', { enum: ['student', 'schedule', 'month'] }),
    q('top', { type: Number, minimum: 1, maximum: 10 }),
    ApiProduces('text/csv'),
  )
  @ApiOkResponse({
    description: 'The CSV file',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  @ApiResponse({
    status: 422,
    description: 'REPORT_TOO_LARGE: narrow the range',
  })
  @ApiParam({ name: 'kind', enum: REPORT_KINDS })
  async export(
    @Param('kind', new ZodValidationPipe(kindParamSchema)) kind: ReportKind,
    @Query() rawQuery: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const query = new ZodValidationPipe(REPORT_QUERIES[kind]).transform(
      rawQuery,
    ) as ReportQuery;
    const { filename, content } = await mapped(() =>
      this.reports.exportCsv(kind, query),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return content;
  }
}
