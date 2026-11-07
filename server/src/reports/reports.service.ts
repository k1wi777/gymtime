import { Inject, Injectable, Optional } from '@nestjs/common';
import { AlarmService } from '../alarm/alarm.service.js';
import type { AlarmEvent } from '../alarm/domain/alarm-event.js';
import type { AttendanceSession } from '../attendance/domain/attendance-session.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import {
  addDays,
  fromBogota,
  toBogotaParts,
  weekdayOf,
} from '../common/time/bogota.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { DevicesService } from '../devices/devices.service.js';
import { InstancesService } from '../schedules/instances.service.js';
import type { ScheduleAssignment } from '../schedules/domain/schedules.repository.js';
import type { ScheduleInstance } from '../schedules/domain/schedule-instance.js';
import { PeriodsService } from '../schedules/periods/periods.service.js';
import { SchedulesService } from '../schedules/schedules.service.js';
import { StudentsService } from '../students/students.service.js';
import { MAX_REPORT_ROWS, csvFilename, reportToCsv } from './csv-export.js';
import { computeAlarms, type AlarmSummary } from './domain/alarms.js';
import { computeAttendance } from './domain/attendance.js';
import type { GroupBy, ReportContext, StudentInfo } from './domain/context.js';
import {
  MAX_RANGE_DAYS,
  defaultRange,
  normalizeText,
  resolveFilters,
  selectStudentIds,
  type RawFilters,
  type ReportFilters,
} from './domain/filters.js';
import { computeFlow, flowTable } from './domain/flow.js';
import { computeLate } from './domain/late.js';
import { computeObligations, type Obligation } from './domain/occurrences.js';
import { OfflineReviewService } from '../offline/offline-review.service.js';
import { computeQuality } from './domain/quality.js';
import { computeStay } from './domain/stay.js';
import { computeStudentDetail } from './domain/student-detail.js';
import { summarizeRange } from './domain/summary.js';
import { sortRows, type ReportTable, type SortDir } from './domain/table.js';
import type {
  FlowReportDto,
  ReportKind,
  ReportOptionsDto,
  StudentDetailDto,
  SummaryDto,
} from './reports.dto.js';

/** A list or export would exceed `MAX_REPORT_ROWS`; the caller must narrow the range. */
export class ReportTooLargeError extends Error {
  constructor() {
    super(
      `El reporte supera ${MAX_REPORT_ROWS} filas: acote el rango de fechas o los filtros`,
    );
  }
}

export interface ReportQuery extends RawFilters {
  sort?: string;
  dir?: SortDir;
  groupBy?: GroupBy;
  top?: number;
}

export type FilteredTable = ReportTable & { filters: ReportFilters };

/** Everything the metrics need for one filtered range, loaded once. */
interface Dataset {
  filters: ReportFilters;
  ctx: ReportContext;
  occurrences: ScheduleInstance[];
  sessions: AttendanceSession[];
  studentIds: ReadonlySet<string> | null;
  /** Empty unless the report asked for them. */
  assignments: ScheduleAssignment[];
  closedOn: (scheduleId: string, date: string) => boolean;
}

interface Needs {
  assignments?: boolean;
}

/**
 * Report read models (E23). It owns no data: it loads rows through the other
 * modules' services, filtered by range in the database, and hands them to the
 * pure functions in `domain/`, which hold every definition of the metrics.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly students: StudentsService,
    private readonly schedules: SchedulesService,
    private readonly instances: InstancesService,
    private readonly periods: PeriodsService,
    private readonly attendance: AttendanceService,
    private readonly alarm: AlarmService,
    private readonly devices: DevicesService,
    private readonly eventLog: EventLogService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() private readonly offline?: OfflineReviewService,
  ) {}

  private today(): string {
    return toBogotaParts(this.clock.now()).date;
  }

  private async activePeriod() {
    return (await this.periods.list()).find((p) => p.period.active) ?? null;
  }

  async options(): Promise<ReportOptionsDto> {
    const [students, schedules, active] = await Promise.all([
      this.students.list(),
      this.schedules.listAll(),
      this.activePeriod(),
    ]);
    const programs = new Map<string, string>();
    for (const s of students) {
      if (s.program) programs.set(normalizeText(s.program), s.program);
    }
    return {
      programs: [...programs.values()].sort((a, b) => a.localeCompare(b, 'es')),
      schedules: schedules
        .sort(
          (a, b) =>
            (a.weekday ?? 8) - (b.weekday ?? 8) ||
            a.startTime.localeCompare(b.startTime) ||
            a.name.localeCompare(b.name, 'es'),
        )
        .map((s) => ({
          id: s.id,
          name: s.name,
          weekday: s.weekday,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      period: active
        ? {
            id: active.period.id,
            name: active.period.name,
            startDate: active.period.startDate,
            endDate: active.period.endDate,
          }
        : null,
      defaultRange: defaultRange(active?.period ?? null, this.today()),
      maxRangeDays: MAX_RANGE_DAYS,
    };
  }

  /** @throws ReportFilterError when the range is invalid. */
  private async filtersOf(raw: RawFilters): Promise<ReportFilters> {
    return resolveFilters(
      raw,
      (await this.activePeriod())?.period ?? null,
      this.today(),
    );
  }

  private async load(
    filters: ReportFilters,
    needs: Needs = {},
  ): Promise<Dataset> {
    const [students, periods] = await Promise.all([
      this.students.list(),
      this.periods.list(),
    ]);
    const studentIds = selectStudentIds(students, filters);
    const occurrences = await this.instances.findByDates(
      filters.from,
      filters.to,
      filters.scheduleId ? [filters.scheduleId] : undefined,
    );
    const scheduleIds = [...new Set(occurrences.map((o) => o.scheduleId))];
    const [schedules, sessions, assignments] = await Promise.all([
      this.schedules.findByIds(scheduleIds),
      this.attendance.listForReport(
        occurrences.map((o) => o.id),
        studentIds ? [...studentIds] : undefined,
      ),
      needs.assignments
        ? this.schedules.listAssignmentsFor(
            scheduleIds,
            studentIds ? [...studentIds] : undefined,
          )
        : Promise.resolve([]),
    ]);
    const exceptions = new Map(
      periods.map((p) => [p.period.id, p.exceptions] as const),
    );
    const scheduleById = new Map(schedules.map((s) => [s.id, s]));
    return {
      filters,
      occurrences,
      sessions,
      studentIds,
      assignments,
      ctx: {
        now: this.clock.now(),
        instances: new Map(occurrences.map((o) => [o.id, o])),
        schedules: scheduleById,
        students: new Map<string, StudentInfo>(
          students.map((s) => [
            s.id,
            { id: s.id, name: s.name, program: s.program },
          ]),
        ),
      },
      closedOn: (scheduleId, date) => {
        const periodId = scheduleById.get(scheduleId)?.periodId;
        return (
          !!periodId &&
          (exceptions.get(periodId) ?? []).some(
            (e) => e.from <= date && date <= e.to,
          )
        );
      },
    };
  }

  private obligationsOf(ds: Dataset): Obligation[] {
    return computeObligations({
      occurrences: ds.occurrences,
      assignments: ds.assignments,
      closedOn: ds.closedOn,
      now: ds.ctx.now,
      studentIds: ds.studentIds,
    });
  }

  /** Sorts as the screen shows it and refuses a table too big to hold. */
  private finish(
    filters: ReportFilters,
    table: ReportTable,
    query: Pick<ReportQuery, 'sort' | 'dir'>,
  ): FilteredTable {
    if (table.rows.length > MAX_REPORT_ROWS) throw new ReportTooLargeError();
    return {
      ...table,
      filters,
      rows: sortRows(table.columns, table.rows, query.sort, query.dir),
    };
  }

  async flow(query: ReportQuery): Promise<FlowReportDto> {
    const ds = await this.load(await this.filtersOf(query));
    const flow = computeFlow(ds.sessions, query.top);
    const table = this.finish(ds.filters, flowTable(flow), query);
    return {
      ...table,
      total: flow.total,
      distinctStudents: flow.distinctStudents,
      byHour: flow.byHour,
      byWeekday: flow.byWeekday,
      peaks: flow.peaks,
    } as FlowReportDto;
  }

  async attendanceReport(query: ReportQuery): Promise<FilteredTable> {
    const ds = await this.load(await this.filtersOf(query), {
      assignments: true,
    });
    return this.finish(
      ds.filters,
      computeAttendance(
        this.obligationsOf(ds),
        ds.sessions,
        query.groupBy ?? 'student',
        ds.ctx,
      ),
      query,
    );
  }

  async stay(query: ReportQuery): Promise<FilteredTable> {
    const ds = await this.load(await this.filtersOf(query));
    return this.finish(
      ds.filters,
      computeStay(ds.sessions, query.groupBy ?? 'student', ds.ctx),
      query,
    );
  }

  async late(query: ReportQuery): Promise<FilteredTable> {
    const ds = await this.load(await this.filtersOf(query));
    const groupBy = query.groupBy === 'schedule' ? 'schedule' : 'student';
    return this.finish(
      ds.filters,
      computeLate(ds.sessions, groupBy, ds.ctx),
      query,
    );
  }

  async alarms(
    query: ReportQuery,
  ): Promise<FilteredTable & { summary: AlarmSummary }> {
    const ds = await this.load(await this.filtersOf(query));
    const events: AlarmEvent[] = await this.alarm.findByInstanceIds(
      ds.occurrences.map((o) => o.id),
    );
    const { summary, ...table } = computeAlarms(events, ds.ctx);
    return { ...this.finish(ds.filters, table, query), summary };
  }

  async quality(query: ReportQuery): Promise<FilteredTable> {
    const ds = await this.load(await this.filtersOf(query));
    const outcomes = await this.offline?.outcomeCounts({
      from: fromBogota(ds.filters.from, '00:00'),
      to: new Date(
        fromBogota(addDays(ds.filters.to, 1), '00:00').getTime() - 1,
      ),
    });
    return this.finish(
      ds.filters,
      computeQuality(ds.sessions, ds.ctx, outcomes),
      query,
    );
  }

  /** Null when the student does not exist. */
  async studentDetail(
    studentId: string,
    query: ReportQuery,
  ): Promise<StudentDetailDto | null> {
    const student = await this.students.findById(studentId);
    if (!student) return null;
    const ds = await this.load(await this.filtersOf({ ...query, studentId }), {
      assignments: true,
    });
    const obligations = this.obligationsOf(ds);
    const table = this.finish(
      ds.filters,
      computeStudentDetail(studentId, obligations, ds.sessions, ds.ctx),
      query,
    );
    return {
      ...table,
      student: { id: student.id, name: student.name, program: student.program },
    } as StudentDetailDto;
  }

  /**
   * The CSV of a report, with the same filters, columns and order as the
   * JSON. The export is written to the audit trail first (Ley 1581): if that
   * fails, no file is delivered.
   */
  async exportCsv(
    kind: ReportKind,
    query: ReportQuery,
  ): Promise<{ filename: string; content: string }> {
    const table = await this.tableOf(kind, query);
    await this.eventLog.recordOrThrow('report.exported', {
      report: kind,
      from: table.filters.from,
      to: table.filters.to,
      scheduleId: table.filters.scheduleId,
      program: table.filters.program,
      studentId: table.filters.studentId,
      groupBy: query.groupBy,
      sort: query.sort,
      dir: query.dir,
      rows: table.rows.length,
    });
    return {
      filename: csvFilename(kind, table.filters.from, table.filters.to),
      content: reportToCsv(table),
    };
  }

  private tableOf(
    kind: ReportKind,
    query: ReportQuery,
  ): Promise<FilteredTable> {
    switch (kind) {
      case 'flow':
        return this.flow(query);
      case 'attendance':
        return this.attendanceReport(query);
      case 'stay':
        return this.stay(query);
      case 'late':
        return this.late(query);
      case 'alarms':
        return this.alarms(query);
      case 'quality':
        return this.quality(query);
    }
  }

  /** Administrator's landing page (E24-5). */
  async summary(): Promise<SummaryDto> {
    const now = this.clock.now();
    const date = this.today();
    const weekStart = addDays(date, 1 - weekdayOf(date));
    const active = await this.activePeriod();
    const periodEnd =
      active && active.period.endDate < date ? active.period.endDate : date;
    const widest = addDays(date, -(MAX_RANGE_DAYS - 1));
    const earliest = [weekStart, active?.period.startDate ?? weekStart].reduce(
      (a, b) => (a < b ? a : b),
    );
    const ds = await this.load(
      { from: earliest < widest ? widest : earliest, to: date },
      { assignments: true },
    );
    const obligations = this.obligationsOf(ds);
    const range = (a: string, b: string) =>
      summarizeRange(obligations, ds.sessions, ds.ctx, a, b);
    const [open, device, alarm, unregistered7d] = await Promise.all([
      this.attendance.listOpen(),
      this.devices.listStatus(),
      this.alarm.status(),
      this.attendance.countSessions({
        status: 'no_registrada',
        from: new Date(now.getTime() - 7 * 86_400_000),
        to: now,
      }),
    ]);
    return {
      date,
      weekStart,
      today: { ...range(date, date), inside: open.length },
      week: range(weekStart, date),
      period: active
        ? {
            name: active.period.name,
            startDate: active.period.startDate,
            endDate: active.period.endDate,
            ...range(active.period.startDate, periodEnd),
          }
        : null,
      alerts: {
        alarmOn: alarm.on,
        device: {
          known: device.length > 0,
          online: device.some((d) => d.online),
        },
        staleOpen: open.filter((s) => s.instance.endsAt <= now).length,
        unregistered7d,
      },
    };
  }
}
