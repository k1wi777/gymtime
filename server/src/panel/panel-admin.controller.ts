import { ATTENDANCE_SOURCES } from '../attendance/dto/attendance.dto.js';
import { applyDecorators, Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { ApiAuth, Roles } from '../common/auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  AlarmHistoryDto,
  AttendanceHistoryDto,
  AuditPageDto,
  OrdersPageDto,
  PanelStudentsDto,
  WeekDto,
  alarmsQuerySchema,
  attendanceHistoryQuerySchema,
  auditQuerySchema,
  ordersQuerySchema,
  panelStudentsQuerySchema,
  weekQuerySchema,
} from './dto/admin-panel.dto.js';
import { PanelAdminService } from './panel-admin.service.js';

const toDate = (value: string | undefined): Date | undefined =>
  value ? new Date(value) : undefined;

const query = (name: string, extra: Record<string, unknown> = {}) =>
  ApiQuery({ name, required: false, ...extra });
const RANGE = [
  query('from', { description: 'ISO instant, inclusive' }),
  query('to', { description: 'ISO instant, inclusive' }),
];
const paged = (...own: MethodDecorator[]) =>
  applyDecorators(
    ...RANGE,
    ...own,
    query('limit', { type: Number, minimum: 1, maximum: 200 }),
  );

/**
 * Read models for the administrator screens (H9). The student list and the
 * weekly view are open to every role (the assistant also needs them); the
 * history and audit trails are for administrators only.
 */
@ApiTags('panel')
@ApiAuth()
@Controller()
export class PanelAdminController {
  constructor(private readonly panel: PanelAdminService) {}

  @Get('panel/students')
  @ApiOperation({
    summary: 'Students with fingerprint and consent state',
    description:
      'Search by name or document, filter by degree, state and fingerprint (`none` = not enrolled yet); paginated.',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'program', required: false })
  @ApiQuery({
    name: 'fingerprint',
    required: false,
    enum: ['none', 'enrolled'],
  })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 200 })
  @ApiQuery({ name: 'offset', required: false, minimum: 0 })
  @ApiOkResponse({ type: PanelStudentsDto })
  @ApiBadRequestResponse({ description: 'Invalid query' })
  students(
    @Query(new ZodValidationPipe(panelStudentsQuerySchema))
    query: z.infer<typeof panelStudentsQuerySchema>,
  ): Promise<PanelStudentsDto> {
    return this.panel.listStudents({
      ...query,
      active: query.active === undefined ? undefined : query.active === 'true',
    });
  }

  @Get('panel/schedules/week')
  @ApiOperation({
    summary: 'Weekly view of the recurring schedules of a period',
    description:
      'Day, hour and number of students assigned for each schedule; the days without service of the week are flagged. Defaults: active period, current week.',
  })
  @ApiQuery({ name: 'periodId', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'weekStart',
    required: false,
    example: '2026-11-02',
    description: 'Any Bogota day of the week wanted; the Monday is derived',
  })
  @ApiOkResponse({ type: WeekDto })
  @ApiBadRequestResponse({ description: 'Invalid query' })
  week(
    @Query(new ZodValidationPipe(weekQuerySchema))
    query: z.infer<typeof weekQuerySchema>,
  ): Promise<WeekDto> {
    return this.panel.week(query.periodId, query.weekStart);
  }

  @Get('panel/attendance/history')
  @Roles('admin')
  @ApiOperation({
    summary: 'History of entries and exits (administrator)',
    description:
      'Filters: date range of the entry, schedule, student, origin (`device` fingerprint, `manual` or `offline`), status and a name/document search. Manual rows carry the reason and who registered them. The `offline` origin marks sessions reconciled from the device queue.',
  })
  @paged(
    query('scheduleId', { format: 'uuid' }),
    query('studentId', { format: 'uuid' }),
    query('source', { enum: ATTENDANCE_SOURCES }),
    query('status', { enum: ['abierta', 'cerrada', 'no_registrada'] }),
    query('search'),
    query('offset', { type: Number, minimum: 0 }),
  )
  @ApiOkResponse({ type: AttendanceHistoryDto })
  @ApiBadRequestResponse({ description: 'Invalid query' })
  attendanceHistory(
    @Query(new ZodValidationPipe(attendanceHistoryQuerySchema))
    query: z.infer<typeof attendanceHistoryQuerySchema>,
  ): Promise<AttendanceHistoryDto> {
    return this.panel.attendanceHistory({
      ...query,
      from: toDate(query.from),
      to: toDate(query.to),
    });
  }

  @Get('audit')
  @Roles('admin')
  @ApiOperation({
    summary: 'Audit trail (administrator)',
    description:
      'Newest first, paginated by cursor (`before` = `nextBefore` of the previous page). `type` matches by prefix (`student.`).',
  })
  @paged(
    query('type'),
    query('actorId'),
    query('before', { type: Number, minimum: 1 }),
  )
  @ApiOkResponse({ type: AuditPageDto })
  @ApiBadRequestResponse({ description: 'Invalid query' })
  audit(
    @Query(new ZodValidationPipe(auditQuerySchema))
    query: z.infer<typeof auditQuerySchema>,
  ): Promise<AuditPageDto> {
    return this.panel.audit({
      ...query,
      from: toDate(query.from),
      to: toDate(query.to),
    });
  }

  @Get('history/orders')
  @Roles('admin')
  @ApiOperation({
    summary: 'Orders sent to the reader (administrator)',
    description:
      'Screen messages, alarm on/off and syncs, with who gave the order, when and the result.',
  })
  @paged(query('before', { type: Number, minimum: 1 }))
  @ApiOkResponse({ type: OrdersPageDto })
  @ApiBadRequestResponse({ description: 'Invalid query' })
  orders(
    @Query(new ZodValidationPipe(ordersQuerySchema))
    query: z.infer<typeof ordersQuerySchema>,
  ): Promise<OrdersPageDto> {
    return this.panel.orders({
      ...query,
      from: toDate(query.from),
      to: toDate(query.to),
    });
  }

  @Get('history/alarms')
  @Roles('admin')
  @ApiOperation({
    summary: 'Alarm history (administrator)',
    description:
      'Schedule, start, end, how it was closed and the sessions closed; `closedByActor` is the audit actor closest in time for manual and button closures.',
  })
  @paged(query('offset', { type: Number, minimum: 0 }))
  @ApiOkResponse({ type: AlarmHistoryDto })
  @ApiBadRequestResponse({ description: 'Invalid query' })
  alarms(
    @Query(new ZodValidationPipe(alarmsQuerySchema))
    query: z.infer<typeof alarmsQuerySchema>,
  ): Promise<AlarmHistoryDto> {
    return this.panel.alarms({
      ...query,
      from: toDate(query.from),
      to: toDate(query.to),
    });
  }
}
