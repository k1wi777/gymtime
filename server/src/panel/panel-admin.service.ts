import { Inject, Injectable } from '@nestjs/common';
import { AlarmService } from '../alarm/alarm.service.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { PanelUsersService } from '../auth/panel-users.service.js';
import type { Actor } from '../common/audit/actor.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import type { StoredEvent } from '../common/audit/event-log.repository.js';
import { addDays, toBogotaParts, weekdayOf } from '../common/time/bogota.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { DevicesService } from '../devices/devices.service.js';
import { FingerprintsService } from '../fingerprints/fingerprints.service.js';
import { InstancesService } from '../schedules/instances.service.js';
import { PeriodsService } from '../schedules/periods/periods.service.js';
import { SchedulesService } from '../schedules/schedules.service.js';
import { StudentsService } from '../students/students.service.js';
import type {
  AlarmHistoryDto,
  AttendanceHistoryDto,
  AuditPageDto,
  HistoryActorDto,
  OrdersPageDto,
  PanelStudentsDto,
  WeekDto,
} from './dto/admin-panel.dto.js';

export interface StudentsQuery {
  search?: string;
  active?: boolean;
  program?: string;
  fingerprint?: 'none' | 'enrolled';
  limit: number;
  offset: number;
}

export interface AttendanceHistoryQuery {
  from?: Date;
  to?: Date;
  scheduleId?: string;
  studentId?: string;
  source?: 'device' | 'manual';
  status?: 'abierta' | 'cerrada' | 'no_registrada';
  search?: string;
  limit: number;
  offset: number;
}

export interface AuditQuery {
  type?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  before?: number;
}

/** Event types that are orders given to the reader (E22-3). */
export const ORDER_EVENT_TYPES = [
  'display.message_sent',
  'alarm.manual_on',
  'alarm.manual_off',
  'alarm.button_off',
  'sync.triggered',
];

/** An actor and the alarm event it closed are matched within this many ms. */
const ALARM_MATCH_MS = 5_000;

/**
 * Read models for the administrator's screens (H9): the student list with
 * fingerprint state, the weekly schedule view and the history and audit
 * trails. It owns no data and writes nothing.
 */
@Injectable()
export class PanelAdminService {
  constructor(
    private readonly students: StudentsService,
    private readonly fingerprints: FingerprintsService,
    private readonly periods: PeriodsService,
    private readonly schedules: SchedulesService,
    private readonly instances: InstancesService,
    private readonly attendance: AttendanceService,
    private readonly alarm: AlarmService,
    private readonly devices: DevicesService,
    private readonly eventLog: EventLogService,
    private readonly accounts: PanelUsersService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Students with fingerprint and consent state, filtered and paginated (E20-1, E20-5). */
  async listStudents(query: StudentsQuery): Promise<PanelStudentsDto> {
    const found = await this.students.list({
      active: query.active,
      search: query.search,
      program: query.program,
    });
    const since = await this.fingerprints.findEnrolledSince(
      found.map((s) => s.id),
    );
    const matching = found.filter(
      (s) =>
        query.fingerprint === undefined ||
        since.has(s.id) === (query.fingerprint === 'enrolled'),
    );
    const page = matching.slice(query.offset, query.offset + query.limit);
    return {
      total: matching.length,
      items: page.map((student) => ({
        ...student,
        consentAt: student.consentAt?.toISOString() ?? null,
        fingerprintEnrolledAt: since.get(student.id)?.toISOString() ?? null,
      })),
    };
  }

  /** Recurring schedules of a period laid out over one week (E19-5). */
  async week(periodId?: string, weekStart?: string): Promise<WeekDto> {
    const today = toBogotaParts(this.clock.now()).date;
    const monday = weekStart ?? addDays(today, 1 - weekdayOf(today));
    const detail = periodId
      ? await this.periods.get(periodId)
      : ((await this.periods.list()).find((p) => p.period.active) ?? null);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const days = dates.map((date) => ({
      date,
      weekday: weekdayOf(date),
      closedReason:
        detail?.exceptions.find((e) => e.from <= date && date <= e.to)
          ?.reason ?? null,
    }));
    if (!detail)
      return { period: null, weekStart: monday, days, schedules: [] };
    const schedules = await this.schedules.listByPeriod(detail.period.id);
    const counts = await this.schedules.currentStudentIds(
      schedules.map((s) => s.id),
    );
    return {
      period: detail.period,
      weekStart: monday,
      days,
      schedules: schedules.flatMap((s) =>
        s.weekday === null
          ? []
          : [
              {
                id: s.id,
                name: s.name,
                weekday: s.weekday,
                startTime: s.startTime,
                endTime: s.endTime,
                assignedCount: counts.get(s.id)?.length ?? 0,
              },
            ],
      ),
    };
  }

  /** Entries and exits with filters and pagination, newest first (E22-1). */
  async attendanceHistory(
    query: AttendanceHistoryQuery,
  ): Promise<AttendanceHistoryDto> {
    const empty = { items: [], total: 0 };
    let studentIds: string[] | undefined;
    if (query.search) {
      studentIds = (await this.students.list({ search: query.search })).map(
        (s) => s.id,
      );
      if (studentIds.length === 0) return empty;
    }
    let instanceIds: string[] | undefined;
    if (query.scheduleId) {
      instanceIds = await this.instances.idsOfSchedule(query.scheduleId);
      if (instanceIds.length === 0) return empty;
    }
    const { items, total } = await this.attendance.pageSessions({
      studentId: query.studentId,
      studentIds,
      instanceIds,
      source: query.source,
      status: query.status,
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    });
    const scheduleNames = new Map(
      (
        await this.schedules.findByIds(items.map((i) => i.instance.scheduleId))
      ).map((s) => [s.id, s.name]),
    );
    const manual = items
      .filter((s) => s.entrySource === 'manual' || s.exitSource === 'manual')
      .map((s) => s.id);
    const authors = await this.manualAuthors(manual);
    return {
      total,
      items: items.map((s) => ({
        id: s.id,
        student: s.student,
        schedule: {
          id: s.instance.scheduleId,
          name: scheduleNames.get(s.instance.scheduleId) ?? '',
        },
        startsAt: s.instance.startsAt.toISOString(),
        enteredAt: s.enteredAt.toISOString(),
        exitedAt: s.exitedAt?.toISOString() ?? null,
        entrySource: s.entrySource,
        exitSource: s.exitSource,
        status: s.status,
        manualReason: s.manualReason,
        entryBy:
          s.entrySource === 'manual'
            ? (authors.get(`${s.id}:entry`) ?? null)
            : null,
        exitBy:
          s.exitSource === 'manual'
            ? (authors.get(`${s.id}:exit`) ?? null)
            : null,
      })),
    };
  }

  /** The audit trail, newest first, paginated by cursor (E22-2). */
  async audit(query: AuditQuery): Promise<AuditPageDto> {
    const events = await this.eventLog.search({
      typePrefix: query.type,
      actorId: query.actorId,
      from: query.from,
      to: query.to,
      before: query.before,
      limit: query.limit,
    });
    const actors = await this.resolveActors(events.map((e) => e.actor));
    return {
      items: events.map((e) => ({
        id: e.id,
        type: e.type,
        createdAt: e.createdAt.toISOString(),
        actor: actors(e.actor),
        detail: e.detail,
      })),
      nextBefore:
        events.length === query.limit ? (events.at(-1)?.id ?? null) : null,
    };
  }

  /** Orders given to the reader and their result (E22-3). */
  async orders(query: {
    from?: Date;
    to?: Date;
    limit: number;
    before?: number;
  }): Promise<OrdersPageDto> {
    const events = await this.eventLog.search({
      types: ORDER_EVENT_TYPES,
      from: query.from,
      to: query.to,
      before: query.before,
      limit: query.limit,
    });
    const actors = await this.resolveActors(events.map((e) => e.actor));
    const commandIds = events.flatMap((e) =>
      typeof e.detail?.commandId === 'string' ? [e.detail.commandId] : [],
    );
    const statuses = await this.devices.commandStatuses(commandIds);
    return {
      items: events.map((e) => {
        const detail = e.detail ?? {};
        const commandId = asString(detail.commandId);
        return {
          id: e.id,
          type: e.type,
          createdAt: e.createdAt.toISOString(),
          actor: actors(e.actor),
          deviceId: asString(detail.deviceId),
          // The audit stores the status at send time; the queue has the latest.
          status:
            (commandId ? statuses.get(commandId) : undefined) ??
            asString(detail.status),
          sessionsClosed:
            typeof detail.sessionsClosed === 'number'
              ? detail.sessionsClosed
              : null,
          text:
            e.type === 'display.message_sent'
              ? [asString(detail.line1), asString(detail.line2)]
                  .filter(Boolean)
                  .join(' / ')
              : null,
        };
      }),
      nextBefore:
        events.length === query.limit ? (events.at(-1)?.id ?? null) : null,
    };
  }

  /** Alarm history with the schedule and how each alarm ended (E22-3). */
  async alarms(query: {
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<AlarmHistoryDto> {
    const { items, total } = await this.alarm.history(query);
    const occurrences = await this.instances.getByIds(
      items.map((i) => i.instanceId),
    );
    const closers = await this.alarmClosers(
      items.flatMap((i) => (i.endedAt ? [i.endedAt] : [])),
    );
    return {
      total,
      items: items.map((event) => {
        const occurrence = occurrences.get(event.instanceId);
        return {
          id: event.id,
          schedule: occurrence
            ? { id: occurrence.schedule.id, name: occurrence.schedule.name }
            : null,
          scheduleStartsAt: occurrence?.instance.startsAt.toISOString() ?? null,
          startedAt: event.startedAt.toISOString(),
          endedAt: event.endedAt?.toISOString() ?? null,
          closedBy: event.closedBy,
          closedSessions: event.closedSessions,
          closedByActor:
            event.endedAt &&
            (event.closedBy === 'cli' || event.closedBy === 'button')
              ? closers(event.endedAt)
              : null,
        };
      }),
    };
  }

  /** `${sessionId}:entry|exit` -> who registered it by hand. */
  private async manualAuthors(
    sessionIds: string[],
  ): Promise<Map<string, HistoryActorDto>> {
    const result = new Map<string, HistoryActorDto>();
    if (sessionIds.length === 0) return result;
    const events = await this.eventLog.search({
      types: ['attendance.manual'],
      detailMatch: { key: 'sessionId', values: sessionIds },
      limit: sessionIds.length * 2,
    });
    const actors = await this.resolveActors(events.map((e) => e.actor));
    for (const event of events) {
      const kind = asString(event.detail?.kind);
      const sessionId = asString(event.detail?.sessionId);
      if (kind && sessionId) {
        result.set(`${sessionId}:${kind}`, actors(event.actor));
      }
    }
    return result;
  }

  /** For each alarm end instant, the actor of the manual or button-off event nearest in time. */
  private async alarmClosers(
    endings: Date[],
  ): Promise<(at: Date) => HistoryActorDto | null> {
    if (endings.length === 0) return () => null;
    const times = endings.map((d) => d.getTime());
    const events = await this.eventLog.search({
      types: ['alarm.manual_off', 'alarm.button_off'],
      from: new Date(Math.min(...times) - ALARM_MATCH_MS),
      to: new Date(Math.max(...times) + ALARM_MATCH_MS),
      limit: 500,
    });
    const actors = await this.resolveActors(events.map((e) => e.actor));
    return (at) => {
      let best: StoredEvent | null = null;
      for (const event of events) {
        const gap = Math.abs(event.createdAt.getTime() - at.getTime());
        if (
          gap <= ALARM_MATCH_MS &&
          (!best || gap < Math.abs(best.createdAt.getTime() - at.getTime()))
        ) {
          best = event;
        }
      }
      return best ? actors(best.actor) : null;
    };
  }

  /** Names of the panel users behind the actors, in one lookup. */
  private async resolveActors(
    actors: Actor[],
  ): Promise<(actor: Actor) => HistoryActorDto> {
    const ids = [
      ...new Set(
        actors.flatMap((a) => (a.type === 'user' && a.id ? [a.id] : [])),
      ),
    ];
    const names = new Map(
      (await this.accounts.findByIds(ids)).map((a) => [a.id, a.name]),
    );
    return (actor) => ({
      type: actor.type,
      id: actor.id,
      name:
        actor.type === 'user' && actor.id
          ? (names.get(actor.id) ?? null)
          : null,
    });
  }
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;
