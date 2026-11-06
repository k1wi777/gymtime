import type {
  AlarmClosedBy,
  AlarmEvent,
} from '../../alarm/domain/alarm-event.js';
import type {
  AttendanceSession,
  AttendanceSource,
} from '../../attendance/domain/attendance-session.js';
import { addDays, fromBogota, secondsOfDay } from '../../common/time/bogota.js';
import type { Schedule } from '../../schedules/domain/schedule.js';
import type { ScheduleInstance } from '../../schedules/domain/schedule-instance.js';
import type { ScheduleAssignment } from '../../schedules/domain/schedules.repository.js';
import type {
  Period,
  ServiceException,
} from '../../schedules/periods/period.js';
import type { Student } from '../../students/domain/student.js';

/** Fixed seed: the same dataset every time (E23-10). */
export const SEMESTER_SEED = 20260202;
export const SEMESTER_PERIOD_NAME = 'Simulación 2026-1 (semilla)';
export const SEMESTER_START = '2026-02-02';
export const SEMESTER_END = '2026-05-29';
export const SEMESTER_WEEKS = 16;
/** "Now" of the simulated semester: the day after it ended. */
export const SEMESTER_NOW = fromBogota('2026-05-30', '12:00');
/** A "now" in the middle of the semester, for future and in-progress cases. */
export const MID_SEMESTER_NOW = fromBogota('2026-04-08', '06:30');
export const SIM_DOCUMENT_PREFIX = 'SIM-';
const BASE_STUDENTS = 40;

/** Mulberry32: tiny seeded PRNG, so the dataset never depends on `Math.random`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KIND = {
  student: 1,
  schedule: 2,
  period: 3,
  exception: 4,
  instance: 5,
  assignment: 6,
  session: 7,
  alarm: 8,
} as const;

/** Deterministic, valid UUIDs (`zod.uuid()` and PostgreSQL accept them). */
export const seedId = (kind: keyof typeof KIND, n: number): string =>
  `${KIND[kind].toString(16).padStart(2, '0')}000000-5eed-4000-8000-${String(n).padStart(12, '0')}`;

/** Scripted behaviours; each student gets one, by position. */
export const PROFILES = [
  'asiduo',
  'intermitente',
  'se_une_semana_5',
  'sale_semana_10',
  'reasignado',
  'siempre_tarde',
  'nunca_viene',
  'entrada_manual',
  'asiduo',
  'regular',
] as const;
export type Profile = (typeof PROFILES)[number];

const PROGRAMS = [
  'Ingeniería de Sistemas',
  'Medicina Veterinaria',
  'Enfermería',
] as const;

/** (weekday, start, end): five-day week with two evening slots. */
const SCHEDULE_DEFS = [
  { name: 'Lunes 06:00', weekday: 1, start: '06:00:00', end: '07:00:00' },
  { name: 'Martes 18:00', weekday: 2, start: '18:00:00', end: '19:00:00' },
  { name: 'Miércoles 06:00', weekday: 3, start: '06:00:00', end: '07:00:00' },
  { name: 'Jueves 18:00', weekday: 4, start: '18:00:00', end: '19:00:00' },
  { name: 'Viernes 06:00', weekday: 5, start: '06:00:00', end: '07:00:00' },
  { name: 'Viernes 17:00', weekday: 5, start: '17:00:00', end: '18:00:00' },
] as const;

const EXCEPTIONS = [
  { from: '2026-03-23', to: '2026-03-23', reason: 'Festivo (San José)' },
  { from: '2026-03-30', to: '2026-04-05', reason: 'Semana Santa' },
  { from: '2026-05-18', to: '2026-05-18', reason: 'Festivo (Ascensión)' },
] as const;

/** A day without service on which an occurrence survived because it had history. */
const KEPT_NO_SERVICE_DATE = '2026-04-03';
const KEPT_NO_SERVICE_SCHEDULE = 4;

const FIRST_NAMES = [
  'Ana',
  'Luis',
  'María',
  'Carlos',
  'Sofía',
  'Andrés',
  'Laura',
  'Juan',
  'Valentina',
  'Camilo',
];
const LAST_NAMES = [
  'Pérez',
  'Gómez',
  'Díaz',
  'Ríos',
  'Soto',
  'Mora',
  'Vega',
  'Ortiz',
];

/**
 * What the generator decided for one (student, occurrence). The oracle reads
 * only this record (with plain loops), never the domain code under test.
 */
export interface Decision {
  studentId: string;
  scheduleId: string;
  instanceId: string;
  date: string;
  weekday: number;
  startSec: number;
  endSec: number;
  /** Instant the occurrence ends (ms), to tell finished from future ones. */
  endsAtMs: number;
  /** The script says the student owed this occurrence (service day, assigned at its start). */
  owed: boolean;
  attended: boolean;
  entrySource?: AttendanceSource;
  /** Seconds after the occurrence start (negative = early). */
  entryOffsetSec?: number;
  outcome?: 'closed' | 'unregistered' | 'open';
  exitSource?: AttendanceSource;
  /** Seconds between entry and exit, for closed sessions. */
  staySec?: number;
}

export interface SeedStudent extends Student {
  profile: Profile;
}

export interface SeedDataset {
  seed: number;
  scale: number;
  period: Period;
  exceptions: ServiceException[];
  students: SeedStudent[];
  schedules: Schedule[];
  instances: ScheduleInstance[];
  assignments: ScheduleAssignment[];
  sessions: AttendanceSession[];
  alarms: AlarmEvent[];
  decisions: Decision[];
}

interface Plan {
  student: SeedStudent;
  home: number;
  /** First and last owed week indexes (0-based) and a skipped gap, per profile. */
  owed: (week: number) => boolean;
}

const pad4 = (n: number) => String(n).padStart(4, '0');
const monday = (week: number) => addDays(SEMESTER_START, 7 * week);
const dateOf = (week: number, weekday: number) =>
  addDays(monday(week), weekday - 1);
const instantOf = (date: string, sec: number) =>
  new Date(fromBogota(date, '00:00').getTime() + sec * 1000);

const ATTEND_PROBABILITY: Record<Profile, number> = {
  asiduo: 0.96,
  intermitente: 0.55,
  se_une_semana_5: 0.9,
  sale_semana_10: 0.85,
  reasignado: 0.8,
  siempre_tarde: 0.9,
  nunca_viene: 0,
  entrada_manual: 0.9,
  regular: 0.75,
};

/**
 * The simulated semester (E23-10): 16 weeks, 6 schedules, scripted students,
 * manual entries, unregistered exits, every kind of alarm, an open alarm and
 * session, and an occurrence on a day without service. Pure and deterministic.
 */
export function buildSemester(
  options: { seed?: number; scale?: number } = {},
): SeedDataset {
  const seed = options.seed ?? SEMESTER_SEED;
  const scale = Math.max(1, Math.floor(options.scale ?? 1));
  const rand = mulberry32(seed);
  const studentCount = BASE_STUDENTS * scale;

  const period: Period = {
    id: seedId('period', 1),
    name: SEMESTER_PERIOD_NAME,
    startDate: SEMESTER_START,
    endDate: SEMESTER_END,
    active: true,
  };
  const exceptions = EXCEPTIONS.map((e, i) => ({
    id: seedId('exception', i + 1),
    periodId: period.id,
    ...e,
  }));
  const schedules: Schedule[] = SCHEDULE_DEFS.map((d, i) => ({
    id: seedId('schedule', i + 1),
    name: d.name,
    weekday: d.weekday,
    date: null,
    startTime: d.start,
    endTime: d.end,
    entryOpenMinutes: null,
    entryCloseMinutes: null,
    periodId: period.id,
  }));

  const students: SeedStudent[] = [];
  const plans: Plan[] = [];
  const assignments: ScheduleAssignment[] = [];
  const intervalId = (() => {
    let n = 0;
    return () => seedId('assignment', ++n);
  })();
  const occurrenceStart = (week: number, home: number) =>
    instantOf(
      dateOf(week, SCHEDULE_DEFS[home]!.weekday),
      secondsOfDay(SCHEDULE_DEFS[home]!.start),
    );
  const open = (
    scheduleId: string,
    studentId: string,
    from: Date,
    to: Date | null = null,
  ) =>
    assignments.push({
      id: intervalId(),
      scheduleId,
      studentId,
      validFrom: from,
      validTo: to,
    });

  for (let i = 0; i < studentCount; i++) {
    const profile = PROFILES[i % PROFILES.length]!;
    const home = (i * 7 + Math.floor(i / 10)) % SCHEDULE_DEFS.length;
    const name = `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[(i * 3) % LAST_NAMES.length]} ${pad4(i + 1)}`;
    const student: SeedStudent = {
      id: seedId('student', i + 1),
      document: `${SIM_DOCUMENT_PREFIX}${pad4(i + 1)}`,
      name,
      program: PROGRAMS[i % PROGRAMS.length]!,
      email: null,
      phone: null,
      displayName: `SIM ${pad4(i + 1)}`,
      active: true,
      consented: true,
      consentVersion: 'v1-provisional',
      consentAt: fromBogota(SEMESTER_START, '00:00'),
      profile,
    };
    students.push(student);
    const scheduleId = schedules[home]!.id;
    const before = fromBogota(addDays(SEMESTER_START, -1), '00:00');
    const half = 30 * 60_000;
    let owed: Plan['owed'] = () => true;
    if (profile === 'se_une_semana_5') {
      // Assigned 30 minutes into the week-4 occurrence: owes from week 5 on.
      open(
        scheduleId,
        student.id,
        new Date(occurrenceStart(4, home).getTime() + half),
      );
      owed = (w) => w >= 5;
    } else if (profile === 'sale_semana_10') {
      // Unassigned 30 minutes into the week-9 occurrence: still owes that one.
      open(
        scheduleId,
        student.id,
        before,
        new Date(occurrenceStart(9, home).getTime() + half),
      );
      owed = (w) => w <= 9;
    } else if (profile === 'reasignado') {
      // Two intervals; the second starts exactly at the start of week 8.
      open(
        scheduleId,
        student.id,
        before,
        new Date(occurrenceStart(3, home).getTime() + half),
      );
      open(scheduleId, student.id, occurrenceStart(8, home));
      owed = (w) => w <= 3 || w >= 8;
    } else {
      open(scheduleId, student.id, before);
    }
    plans.push({ student, home, owed });
  }

  const instances: ScheduleInstance[] = [];
  const sessions: AttendanceSession[] = [];
  const alarms: AlarmEvent[] = [];
  const decisions: Decision[] = [];
  let instanceN = 0;
  let sessionN = 0;
  let alarmN = 0;
  let occurrenceN = 0;

  const SPECIAL = { week: 14, schedule: 3 };

  function makeInstance(
    week: number | null,
    scheduleIndex: number,
    date: string,
  ) {
    const def = SCHEDULE_DEFS[scheduleIndex]!;
    const instance: ScheduleInstance = {
      id: seedId('instance', ++instanceN),
      scheduleId: schedules[scheduleIndex]!.id,
      date,
      startsAt: instantOf(date, secondsOfDay(def.start)),
      endsAt: instantOf(date, secondsOfDay(def.end)),
      status: 'scheduled',
    };
    instances.push(instance);
    return { instance, def, week };
  }

  /** Draws the session of one attendee and records the decision. */
  function attend(
    ctx: { instance: ScheduleInstance; def: (typeof SCHEDULE_DEFS)[number] },
    plan: Plan,
    owed: boolean,
    forceManual = false,
  ): Decision {
    const { instance, def } = ctx;
    const startSec = secondsOfDay(def.start);
    const endSec = secondsOfDay(def.end);
    const profile = plan.student.profile;
    const manual =
      forceManual || rand() < (profile === 'entrada_manual' ? 0.4 : 0.015);
    let offset: number;
    if (manual) offset = 120 + Math.floor(rand() * 360);
    else if (profile === 'siempre_tarde')
      offset = 180 + Math.floor(rand() * 360);
    else offset = Math.floor(rand() * 540) - 60;
    const manualExit = rand() < 0.03;
    const staySec = Math.min(
      2100 + Math.floor(rand() * 1380),
      endSec - 30 - (startSec + offset),
    );
    return {
      studentId: plan.student.id,
      scheduleId: instance.scheduleId,
      instanceId: instance.id,
      date: instance.date,
      weekday: def.weekday,
      startSec,
      endSec,
      endsAtMs: instance.endsAt.getTime(),
      owed,
      attended: true,
      entrySource: manual ? 'manual' : 'device',
      entryOffsetSec: offset,
      outcome: 'closed',
      exitSource: manualExit ? 'manual' : 'device',
      staySec,
    };
  }

  function toSession(d: Decision): AttendanceSession {
    const entered = instantOf(d.date, d.startSec + (d.entryOffsetSec ?? 0));
    const closed = d.outcome === 'closed';
    return {
      id: seedId('session', ++sessionN),
      studentId: d.studentId,
      instanceId: d.instanceId,
      enteredAt: entered,
      exitedAt: closed
        ? new Date(entered.getTime() + (d.staySec ?? 0) * 1000)
        : null,
      entrySource: d.entrySource ?? 'device',
      exitSource: closed ? (d.exitSource ?? 'device') : null,
      status:
        d.outcome === 'open'
          ? 'abierta'
          : d.outcome === 'unregistered'
            ? 'no_registrada'
            : 'cerrada',
      manualReason:
        d.entrySource === 'manual'
          ? 'Huella no reconocida'
          : d.exitSource === 'manual' && closed
            ? 'Salida registrada por el asistente'
            : null,
    };
  }

  /** Leaves someone inside when the occurrence ends and records the alarm. */
  function overstay(
    ctx: { instance: ScheduleInstance },
    attendees: Decision[],
    kind: AlarmClosedBy | 'open',
  ) {
    const count = kind === 'button' ? 2 : 1;
    const inside = attendees.slice(-count);
    const endsAt = ctx.instance.endsAt;
    const endSec = inside[0]!.endSec;
    let endedAt: Date | null = null;
    let closedSessions = 0;
    inside.forEach((d, k) => {
      if (kind === 'all_exited') {
        d.outcome = 'closed';
        d.exitSource = 'device';
        const exitSec = endSec + 90 + Math.floor(rand() * 210);
        d.staySec = exitSec - (d.startSec + (d.entryOffsetSec ?? 0));
        endedAt = instantOf(d.date, exitSec);
      } else if (kind === 'open') {
        d.outcome = 'open';
        d.exitSource = undefined;
        d.staySec = undefined;
      } else {
        d.outcome = 'unregistered';
        d.exitSource = undefined;
        d.staySec = undefined;
        closedSessions++;
        const wait = { button: 150 + 40 * k, cli: 240, timeout: 900 }[kind];
        endedAt = new Date(endsAt.getTime() + wait * 1000);
      }
    });
    alarms.push({
      id: seedId('alarm', ++alarmN),
      instanceId: ctx.instance.id,
      startedAt: endsAt,
      endedAt: kind === 'open' ? null : endedAt,
      closedBy: kind === 'open' ? null : kind,
      closedSessions,
    });
  }

  const CLOSURES: AlarmClosedBy[] = ['all_exited', 'button', 'cli', 'timeout'];
  let scenarioN = 0;

  for (let week = 0; week < SEMESTER_WEEKS; week++) {
    for (let s = 0; s < SCHEDULE_DEFS.length; s++) {
      const def = SCHEDULE_DEFS[s]!;
      const date = dateOf(week, def.weekday);
      if (EXCEPTIONS.some((e) => e.from <= date && date <= e.to)) continue;
      if (date < SEMESTER_START || date > SEMESTER_END) continue;
      const ctx = makeInstance(week, s, date);
      occurrenceN++;
      const attendees: Decision[] = [];
      for (const plan of plans) {
        const isHome = plan.home === s;
        if (!isHome) continue;
        const owed = plan.owed(week);
        const decision = {
          studentId: plan.student.id,
          scheduleId: ctx.instance.scheduleId,
          instanceId: ctx.instance.id,
          date,
          weekday: def.weekday,
          startSec: secondsOfDay(def.start),
          endSec: secondsOfDay(def.end),
          endsAtMs: ctx.instance.endsAt.getTime(),
          owed,
          attended: false,
        } satisfies Decision;
        if (owed && rand() < ATTEND_PROBABILITY[plan.student.profile]) {
          attendees.push(attend(ctx, plan, true));
        } else decisions.push(decision);
      }
      // A few people attend a schedule that is not theirs (manual entries).
      if (week >= 2 && week <= 7 && s === week % SCHEDULE_DEFS.length) {
        const guest = plans.find(
          (p) => p.home !== s && p.student.profile === 'asiduo',
        );
        if (guest) attendees.push(attend(ctx, guest, false, true));
      }
      if (attendees.length > 0) {
        if (week === SPECIAL.week && s === SPECIAL.schedule) {
          overstay(ctx, attendees, 'open');
        } else if (occurrenceN % 9 === 4) {
          overstay(ctx, attendees, CLOSURES[scenarioN++ % CLOSURES.length]!);
        }
      }
      for (const d of attendees) {
        decisions.push(d);
        sessions.push(toSession(d));
      }
    }
  }

  // Occurrence on a day without service that kept its history: nobody owes it.
  const kept = makeInstance(
    null,
    KEPT_NO_SERVICE_SCHEDULE,
    KEPT_NO_SERVICE_DATE,
  );
  for (const plan of plans
    .filter((p) => p.home === KEPT_NO_SERVICE_SCHEDULE)
    .slice(0, 3)) {
    const d = attend(kept, plan, false);
    decisions.push(d);
    sessions.push(toSession(d));
  }

  return {
    seed,
    scale,
    period,
    exceptions,
    students,
    schedules,
    instances,
    assignments,
    sessions,
    alarms,
    decisions,
  };
}
