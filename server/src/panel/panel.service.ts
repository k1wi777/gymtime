import type { AttendanceSource } from '../attendance/domain/attendance-session.js';
import { Inject, Injectable } from '@nestjs/common';
import { AlarmService } from '../alarm/alarm.service.js';
import { toAlarmStatusDto } from '../alarm/dto/alarm.dto.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { toBogotaParts } from '../common/time/bogota.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { FingerprintsService } from '../fingerprints/fingerprints.service.js';
import { InstancesService } from '../schedules/instances.service.js';
import { SchedulesService } from '../schedules/schedules.service.js';
import type { Student } from '../students/domain/student.js';
import { StudentsService } from '../students/students.service.js';
import type {
  PanelNowDto,
  PanelPersonDto,
  RosterDto,
  RosterRowDto,
} from './dto/panel.dto.js';

export class PanelScheduleNotFoundError extends Error {
  constructor() {
    super('Schedule not found');
  }
}

/**
 * Read-only views for the assistant's panel, composed from existing services.
 * It owns no data and writes nothing.
 */
@Injectable()
export class PanelService {
  constructor(
    private readonly instances: InstancesService,
    private readonly schedules: SchedulesService,
    private readonly attendance: AttendanceService,
    private readonly students: StudentsService,
    private readonly fingerprints: FingerprintsService,
    private readonly alarm: AlarmService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The schedule in progress with who is inside, left and still missing. */
  async now(): Promise<PanelNowDto> {
    const now = this.clock.now();
    const alarm = toAlarmStatusDto(await this.alarm.status());
    const started = (await this.instances.listActive(now)).filter(
      (o) => o.instance.startsAt <= now,
    );
    // Back-to-back schedules: the one that started last is the current one.
    const current = started.sort(
      (a, b) => a.instance.startsAt.getTime() - b.instance.startsAt.getTime(),
    )[started.length - 1];

    if (!current) {
      // Somebody may still be inside after the end: show them, nobody is expected.
      const open = await this.attendance.listOpen();
      const people = await this.people(
        open.map((s) => s.student.id),
        new Map(open.map((s) => [s.student.id, s])),
      );
      return {
        serverNow: now.toISOString(),
        current: null,
        counts: {
          expected: 0,
          inside: people.length,
          exited: 0,
          missing: 0,
        },
        inside: people,
        exited: [],
        missing: [],
        alarm,
      };
    }

    const sessions = await this.attendance.listSessions({
      instanceId: current.instance.id,
    });
    const byStudent = new Map(sessions.map((s) => [s.student.id, s]));
    // Assigned now, plus anyone who already has a session (e.g. removed later).
    const expectedIds = [
      ...new Set([...current.studentIds, ...byStudent.keys()]),
    ];
    const people = await this.people(expectedIds, byStudent);
    const inside = people.filter((p) => p.sessionStatus === 'abierta');
    const exited = people.filter(
      (p) => p.sessionStatus !== null && p.sessionStatus !== 'abierta',
    );
    const missing = people.filter((p) => p.sessionStatus === null);

    return {
      serverNow: now.toISOString(),
      current: {
        scheduleId: current.schedule.id,
        scheduleName: current.schedule.name,
        instanceId: current.instance.id,
        startsAt: current.instance.startsAt.toISOString(),
        endsAt: current.instance.endsAt.toISOString(),
        entryClosesAt: current.window.closesAt.toISOString(),
        entryOpen: now < current.window.closesAt,
        remainingSeconds: Math.max(
          0,
          Math.floor(
            (current.instance.endsAt.getTime() - now.getTime()) / 1000,
          ),
        ),
      },
      counts: {
        expected: people.length,
        inside: inside.length,
        exited: exited.length,
        missing: missing.length,
      },
      inside,
      exited,
      missing,
      alarm,
    };
  }

  /**
   * Who had to attend a schedule on a date, who did and who did not. Past and
   * current days use the validity intervals that overlapped the occurrence, so
   * removing a student later does not hide that they were expected.
   * @throws PanelScheduleNotFoundError
   */
  async roster(scheduleId: string, date: string): Promise<RosterDto> {
    const detail = await this.schedules.get(scheduleId);
    if (!detail) throw new PanelScheduleNotFoundError();
    const base = {
      scheduleId,
      scheduleName: detail.schedule.name,
      date,
    };
    const stored = await this.instances.findOnDate(scheduleId, date);
    const now = this.clock.now();
    // Only the next days are generated: further ahead the day is projected.
    const instance =
      stored ??
      (date >= toBogotaParts(now).date
        ? this.instances.projectOnDate(detail.schedule, date)
        : null);
    if (!instance) {
      return {
        ...base,
        occurrence: null,
        phase: null,
        counts: { expected: 0, attended: 0, missing: 0 },
        rows: [],
      };
    }

    const phase =
      now < instance.startsAt
        ? 'future'
        : now >= instance.endsAt
          ? 'past'
          : 'current';
    const [assignments, sessions] = await Promise.all([
      this.schedules.listAssignments(scheduleId),
      stored
        ? this.attendance.listSessions({ instanceId: stored.id })
        : Promise.resolve([]),
    ]);
    // Overlap with the occurrence; a still-open interval also covers the future.
    const assigned = new Set(
      assignments
        .filter(
          (a) =>
            a.validFrom < instance.endsAt &&
            (a.validTo === null || a.validTo > instance.startsAt),
        )
        .map((a) => a.studentId),
    );
    const byStudent = new Map(sessions.map((s) => [s.student.id, s]));
    const ids = [...new Set([...assigned, ...byStudent.keys()])];
    const people = await this.people(ids, byStudent);
    const rows: RosterRowDto[] = people.map((person) => ({
      ...person,
      assigned: assigned.has(person.studentId),
      state:
        person.sessionStatus !== null
          ? 'attended'
          : phase === 'future'
            ? 'expected'
            : 'missing',
    }));
    const attended = rows.filter((r) => r.state === 'attended').length;
    return {
      ...base,
      occurrence: {
        instanceId: stored?.id ?? null,
        date: instance.date,
        startsAt: instance.startsAt.toISOString(),
        endsAt: instance.endsAt.toISOString(),
      },
      phase,
      counts: {
        expected: assigned.size,
        attended,
        missing: rows.filter((r) => r.state === 'missing').length,
      },
      rows,
    };
  }

  /** Ids of the students that already have an enrolled fingerprint. */
  async studentIdsWithFingerprint(): Promise<string[]> {
    const students = await this.students.list();
    const withFingerprint =
      await this.fingerprints.findStudentIdsWithFingerprint(
        students.map((s) => s.id),
      );
    return [...withFingerprint];
  }

  /** Student data plus session data, ordered by name. */
  private async people(
    ids: string[],
    sessions: Map<string, SessionLike>,
  ): Promise<PanelPersonDto[]> {
    if (ids.length === 0) return [];
    const [students, withFingerprint] = await Promise.all([
      this.students.findByIds(ids),
      this.fingerprints.findStudentIdsWithFingerprint(ids),
    ]);
    return students
      .sort(byName)
      .map((student) =>
        toPerson(
          student,
          withFingerprint.has(student.id),
          sessions.get(student.id),
        ),
      );
  }
}

/** The fields of a session the panel shows; `SessionView` and open sessions both fit. */
interface SessionLike {
  enteredAt: Date;
  exitedAt?: Date | null;
  entrySource?: AttendanceSource;
  status?: PanelPersonDto['sessionStatus'];
}

const byName = (a: Student, b: Student): number =>
  a.name.localeCompare(b.name, 'es');

function toPerson(
  student: Student,
  hasFingerprint: boolean,
  session: SessionLike | undefined,
): PanelPersonDto {
  return {
    studentId: student.id,
    name: student.name,
    document: student.document,
    displayName: student.displayName,
    hasFingerprint,
    enteredAt: session?.enteredAt.toISOString() ?? null,
    exitedAt: session?.exitedAt?.toISOString() ?? null,
    source: session ? (session.entrySource ?? 'device') : null,
    sessionStatus: session ? (session.status ?? 'abierta') : null,
  };
}
