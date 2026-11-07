import type { OfflineReviewReason } from '@gymtime/shared';
import type { AlarmClosedBy, AlarmEvent } from '../alarm/domain/alarm-event.js';
import type { AttendanceSession } from '../attendance/domain/attendance-session.js';
import {
  addDays,
  fromBogota,
  secondsOfDay,
  weekdayOf,
} from '../common/time/bogota.js';
import type { OfflineEventRecord } from '../offline/domain/offline-event.js';
import {
  mulberry32,
  type Decision,
  type Profile,
  type SeedDataset,
  type SeedStudent,
} from '../reports/seed/semester.js';
import type { Schedule } from '../schedules/domain/schedule.js';
import type { ScheduleInstance } from '../schedules/domain/schedule-instance.js';
import type { ScheduleAssignment } from '../schedules/domain/schedules.repository.js';
import type { Period, ServiceException } from '../schedules/periods/period.js';

/** Fixed seed: the same dataset for the same `today`. */
export const DEMO_SEED = 20261107;
/** Every student of the sample set; the wipe does not depend on it. */
export const DEMO_DOCUMENT_PREFIX = 'DEMO-';
export const DEMO_PERIOD_NAME = 'Muestra (datos de demostración)';
export const DEMO_DEVICE_ID = 'esp32-sim-01';
export const DEMO_CONSENT_VERSION = 'v1-provisional';

/**
 * Development passwords of the sample accounts. They are public (documented in
 * docs/datos_de_muestra.md) and valid only on local databases: the seed
 * refuses to run anywhere else.
 */
export const DEMO_USERS = [
  {
    username: 'admin.demo',
    name: 'Ana Administradora',
    role: 'admin',
    password: 'Demo-Admin-2026',
  },
  {
    username: 'asistente.demo',
    name: 'Luis Asistente',
    role: 'asistente',
    password: 'Demo-Asistente-2026',
  },
] as const;

const KIND = {
  student: 1,
  schedule: 2,
  period: 3,
  exception: 4,
  instance: 5,
  assignment: 6,
  session: 7,
  alarm: 8,
  user: 9,
  fingerprint: 10,
  batch: 11,
  snapshot: 12,
  offline: 13,
} as const;

/** Deterministic, valid UUIDs (zod and PostgreSQL accept them). */
export const demoId = (kind: keyof typeof KIND, n: number): string =>
  `${KIND[kind].toString(16).padStart(2, '0')}000000-de00-4000-8000-${String(n).padStart(12, '0')}`;

export interface DemoPanelUser {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'asistente';
}

export interface DemoFingerprint {
  id: string;
  studentId: string;
  createdAt: Date;
}

export interface DemoImportBatch {
  id: string;
  filename: string;
  userId: string;
  createdAt: Date;
  total: number;
  valid: number;
  errors: number;
}

export interface DemoDevice {
  id: string;
  name: string;
  firmwareVersion: string;
  lastConnectedAt: Date;
  capabilities: string[];
}

export interface DemoSnapshot {
  id: string;
  deviceId: string;
  scheduleId: string;
  roster: Record<string, string>;
  createdAt: Date;
}

export interface DemoLogEntry {
  type: string;
  detail: Record<string, unknown>;
  actorType: 'user' | 'system' | 'device';
  actorId: string | null;
  createdAt: Date;
}

export interface DemoDataset extends SeedDataset {
  today: string;
  panelUsers: DemoPanelUser[];
  /** Panel user that recorded the consents and the import. */
  adminId: string;
  /** Student id -> import batch it came from. */
  importedBy: Record<string, string>;
  fingerprints: DemoFingerprint[];
  importBatches: DemoImportBatch[];
  device: DemoDevice;
  snapshots: DemoSnapshot[];
  offlineEvents: OfflineEventRecord[];
  eventLog: DemoLogEntry[];
}

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
  'Daniela',
  'Mateo',
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
  'Cárdenas',
  'Lozano',
];
const PROGRAMS = [
  'Ingeniería de Sistemas',
  'Medicina Veterinaria',
  'Enfermería',
  'Zootecnia',
];

const SCHEDULE_DEFS = [
  { name: 'Lunes 06:00', weekday: 1, start: '06:00:00', end: '07:00:00' },
  { name: 'Martes 18:00', weekday: 2, start: '18:00:00', end: '19:00:00' },
  { name: 'Miércoles 06:00', weekday: 3, start: '06:00:00', end: '07:00:00' },
  { name: 'Jueves 18:00', weekday: 4, start: '18:00:00', end: '19:00:00' },
] as const;

const PROFILE_BY_POSITION: Profile[] = [
  'asiduo',
  'regular',
  'intermitente',
  'siempre_tarde',
  'asiduo',
  'regular',
  'nunca_viene',
  'entrada_manual',
  'asiduo',
  'regular',
];

const ATTEND_PROBABILITY: Record<string, number> = {
  asiduo: 0.95,
  regular: 0.75,
  intermitente: 0.5,
  siempre_tarde: 0.9,
  nunca_viene: 0,
  entrada_manual: 0.9,
};

/** Counts that the documentation and the tests quote. */
export const DEMO_COUNTS = {
  students: 30,
  withFingerprint: 21,
  periodWeeksBack: 8,
  periodWeeksAhead: 6,
} as const;

const mondayOnOrBefore = (date: string): string =>
  addDays(date, -(weekdayOf(date) - 1));

/** The reader LCD has no accents. */
const ascii = (text: string): string =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const pad2 = (n: number) => String(n).padStart(2, '0');
const instantOf = (date: string, sec: number): Date =>
  new Date(fromBogota(date, '00:00').getTime() + sec * 1000);

/**
 * The sample set of the development database (R17): complete with the current
 * schema and relative to `today` (a Bogota `YYYY-MM-DD`). Pure and
 * deterministic: no clock, no randomness, no database. Shaped as a
 * `SeedDataset` so the report oracle of H10 can check it.
 *
 * No session is open and no occurrence has attendance for `today`: the live
 * screen is shown with the simulator (docs/datos_de_muestra.md).
 */
export function buildDemoDataset(options: { today: string }): DemoDataset {
  const { today } = options;
  const rand = mulberry32(DEMO_SEED);
  const periodStart = mondayOnOrBefore(
    addDays(today, -7 * DEMO_COUNTS.periodWeeksBack),
  );
  const weeks = DEMO_COUNTS.periodWeeksBack + DEMO_COUNTS.periodWeeksAhead;
  const periodEnd = addDays(periodStart, weeks * 7 - 1);
  const dateOf = (week: number, weekday: number) =>
    addDays(periodStart, 7 * week + weekday - 1);

  const admin: DemoPanelUser = {
    id: demoId('user', 1),
    ...pick(DEMO_USERS[0]),
  };
  const assistant: DemoPanelUser = {
    id: demoId('user', 2),
    ...pick(DEMO_USERS[1]),
  };

  const period: Period = {
    id: demoId('period', 1),
    name: DEMO_PERIOD_NAME,
    startDate: periodStart,
    endDate: periodEnd,
    active: true,
  };
  const exceptions: ServiceException[] = [
    {
      id: demoId('exception', 1),
      periodId: period.id,
      from: dateOf(2, 1),
      to: dateOf(2, 1),
      reason: 'Festivo (muestra)',
    },
    {
      id: demoId('exception', 2),
      periodId: period.id,
      from: dateOf(10, 1),
      to: dateOf(10, 3),
      reason: 'Semana de receso (muestra)',
    },
  ];
  const closedOn = (date: string) =>
    exceptions.some((e) => e.from <= date && date <= e.to);

  const schedules: Schedule[] = SCHEDULE_DEFS.map((d, i) => ({
    id: demoId('schedule', i + 1),
    name: d.name,
    weekday: d.weekday,
    date: null,
    startTime: d.start,
    endTime: d.end,
    entryOpenMinutes: null,
    entryCloseMinutes: null,
    periodId: period.id,
  }));
  const oneOff: Schedule = {
    id: demoId('schedule', schedules.length + 1),
    name: 'Grupo especial (puntual)',
    weekday: null,
    date: addDays(today, -1),
    startTime: '17:00:00',
    endTime: '18:00:00',
    entryOpenMinutes: null,
    entryCloseMinutes: null,
    periodId: null,
  };
  schedules.push(oneOff);

  // --- Students -------------------------------------------------------
  // 1-21 active, consented, with fingerprint; 22-24 consented, no fingerprint;
  // 25-27 active without consent; 28-29 inactive; 30 anonymised.
  const consentBase = fromBogota(addDays(periodStart, -10), '09:00');
  const students: SeedStudent[] = [];
  for (let i = 1; i <= DEMO_COUNTS.students; i++) {
    const first = FIRST_NAMES[(i - 1) % FIRST_NAMES.length]!;
    const last = LAST_NAMES[(i * 3) % LAST_NAMES.length]!;
    const erased = i === 30;
    const consented = i <= 24 || i === 28 || i === 29;
    const name = erased ? 'Estudiante anonimizado' : `${first} ${last} ${i}`;
    students.push({
      id: demoId('student', i),
      document: erased
        ? `ANON-${demoId('student', i).replaceAll('-', '').slice(0, 8)}`
        : `${DEMO_DOCUMENT_PREFIX}${String(i).padStart(4, '0')}`,
      name,
      program: erased ? null : PROGRAMS[i % PROGRAMS.length]!,
      email: erased ? null : `estudiante${i}@demo.example.edu`,
      phone: erased ? null : `30000000${pad2(i)}`,
      displayName: erased
        ? 'Anonimizado'
        : ascii(`${first} ${last.slice(0, 1)}${i}`),
      active: i <= 27,
      consented,
      consentVersion: consented ? DEMO_CONSENT_VERSION : null,
      consentAt: consented
        ? new Date(consentBase.getTime() + i * 3_600_000)
        : null,
      anonymizedAt: erased ? fromBogota(addDays(today, -5), '10:00') : null,
      profile: PROFILE_BY_POSITION[(i - 1) % PROFILE_BY_POSITION.length]!,
    });
  }
  const home = (i: number) => (i - 1) % SCHEDULE_DEFS.length;

  const importBatches: DemoImportBatch[] = [
    {
      id: demoId('batch', 1),
      filename: 'estudiantes-muestra.csv',
      userId: admin.id,
      createdAt: fromBogota(addDays(periodStart, -9), '10:00'),
      total: 8,
      valid: 6,
      errors: 2,
    },
  ];
  const importedBy: Record<string, string> = {};
  for (let i = 19; i <= 24; i++) {
    importedBy[demoId('student', i)] = importBatches[0]!.id;
  }

  const fingerprints: DemoFingerprint[] = [];
  for (let i = 1; i <= DEMO_COUNTS.withFingerprint; i++) {
    fingerprints.push({
      id: demoId('fingerprint', i),
      studentId: demoId('student', i),
      createdAt: new Date(consentBase.getTime() + i * 3_600_000 + 600_000),
    });
  }

  // --- Assignments with validity intervals -----------------------------
  const startOf = (week: number, s: number) =>
    instantOf(
      dateOf(week, SCHEDULE_DEFS[s]!.weekday),
      secondsOfDay(SCHEDULE_DEFS[s]!.start),
    );
  const before = fromBogota(addDays(periodStart, -1), '00:00');
  const half = 30 * 60_000;
  const assignments: ScheduleAssignment[] = [];
  let assignmentN = 0;
  const open = (
    scheduleId: string,
    studentId: string,
    from: Date,
    to: Date | null = null,
  ) =>
    assignments.push({
      id: demoId('assignment', ++assignmentN),
      scheduleId,
      studentId,
      validFrom: from,
      validTo: to,
    });
  const scheduleOf = (s: number) => schedules[s]!.id;
  for (let i = 1; i <= 24; i++) {
    const id = demoId('student', i);
    if (i === 4) {
      // Moved from Thursday to Monday: two intervals, the second one starts
      // exactly at the start of the week-4 Monday occurrence.
      open(scheduleOf(3), id, before, new Date(startOf(3, 3).getTime() + half));
      open(scheduleOf(0), id, startOf(4, 0));
    } else if (i === 24) {
      // Joins in week 5, 30 minutes after the occurrence started.
      open(
        scheduleOf(home(i)),
        id,
        new Date(startOf(5, home(i)).getTime() + half),
      );
    } else open(scheduleOf(home(i)), id, before);
  }
  // Two students who left (inactive): intervals closed mid-period.
  open(
    scheduleOf(0),
    demoId('student', 28),
    before,
    new Date(startOf(3, 0).getTime() + half),
  );
  open(
    scheduleOf(1),
    demoId('student', 29),
    before,
    new Date(startOf(5, 1).getTime() + half),
  );
  // The one-off group: students 1-6.
  for (let i = 1; i <= 6; i++) {
    open(oneOff.id, demoId('student', i), before);
  }

  // --- Occurrences, attendance and alarms --------------------------------
  const instances: ScheduleInstance[] = [];
  const sessions: AttendanceSession[] = [];
  const alarms: AlarmEvent[] = [];
  const decisions: Decision[] = [];
  let instanceN = 0;
  let sessionN = 0;
  let alarmN = 0;

  const intervalsOf = (scheduleId: string, studentId: string) =>
    assignments.filter(
      (a) => a.scheduleId === scheduleId && a.studentId === studentId,
    );
  const assignedTo = (scheduleId: string) => [
    ...new Set(
      assignments
        .filter((a) => a.scheduleId === scheduleId)
        .map((a) => a.studentId),
    ),
  ];
  const owedAt = (scheduleId: string, studentId: string, at: Date) =>
    intervalsOf(scheduleId, studentId).some(
      (a) =>
        a.validFrom.getTime() <= at.getTime() &&
        (a.validTo === null || a.validTo.getTime() > at.getTime()),
    );
  const profileOf = (studentId: string) =>
    students.find((s) => s.id === studentId)!.profile;

  const makeInstance = (schedule: Schedule, date: string): ScheduleInstance => {
    const instance: ScheduleInstance = {
      id: demoId('instance', ++instanceN),
      scheduleId: schedule.id,
      date,
      startsAt: instantOf(date, secondsOfDay(schedule.startTime)),
      endsAt: instantOf(date, secondsOfDay(schedule.endTime)),
      status: 'scheduled',
    };
    instances.push(instance);
    return instance;
  };

  const attend = (
    instance: ScheduleInstance,
    schedule: Schedule,
    studentId: string,
    owed: boolean,
    forceManual = false,
  ): Decision => {
    const startSec = secondsOfDay(schedule.startTime);
    const endSec = secondsOfDay(schedule.endTime);
    const profile = profileOf(studentId);
    const manual =
      forceManual || rand() < (profile === 'entrada_manual' ? 0.4 : 0.02);
    let offset: number;
    if (manual) offset = 120 + Math.floor(rand() * 360);
    else if (profile === 'siempre_tarde')
      offset = 180 + Math.floor(rand() * 360);
    else offset = Math.floor(rand() * 540) - 60;
    const manualExit = rand() < 0.04;
    const staySec = Math.min(
      2100 + Math.floor(rand() * 1380),
      endSec - 30 - (startSec + offset),
    );
    return {
      studentId,
      scheduleId: schedule.id,
      instanceId: instance.id,
      date: instance.date,
      weekday: weekdayOf(instance.date),
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
  };

  const toSession = (d: Decision): AttendanceSession => {
    const entered = instantOf(d.date, d.startSec + (d.entryOffsetSec ?? 0));
    const closed = d.outcome === 'closed';
    return {
      id: demoId('session', ++sessionN),
      studentId: d.studentId,
      instanceId: d.instanceId,
      enteredAt: entered,
      exitedAt: closed
        ? new Date(entered.getTime() + (d.staySec ?? 0) * 1000)
        : null,
      entrySource: d.entrySource ?? 'device',
      exitSource: closed ? (d.exitSource ?? 'device') : null,
      status: d.outcome === 'unregistered' ? 'no_registrada' : 'cerrada',
      manualReason:
        d.entrySource === 'manual'
          ? 'Huella no reconocida'
          : d.exitSource === 'manual' && closed
            ? 'Salida registrada por el asistente'
            : null,
    };
  };

  /** Leaves someone inside at the end and records the alarm that followed. */
  const overstay = (
    instance: ScheduleInstance,
    attendees: Decision[],
    kind: AlarmClosedBy,
  ) => {
    const inside = attendees.slice(-(kind === 'button' ? 2 : 1));
    let endedAt: Date | null = null;
    let closedSessions = 0;
    inside.forEach((d, k) => {
      if (kind === 'all_exited') {
        d.outcome = 'closed';
        d.exitSource = 'device';
        const exitSec = d.endSec + 90 + Math.floor(rand() * 210);
        d.staySec = exitSec - (d.startSec + (d.entryOffsetSec ?? 0));
        endedAt = instantOf(d.date, exitSec);
      } else {
        d.outcome = 'unregistered';
        d.exitSource = undefined;
        d.staySec = undefined;
        closedSessions++;
        const wait = { button: 150 + 40 * k, cli: 240, timeout: 900 }[kind];
        endedAt = new Date(instance.endsAt.getTime() + wait * 1000);
      }
    });
    alarms.push({
      id: demoId('alarm', ++alarmN),
      instanceId: instance.id,
      startedAt: instance.endsAt,
      endedAt,
      closedBy: kind,
      closedSessions,
      origin: 'server',
      deviceId: null,
      deviceEventId: null,
    });
  };

  const CLOSURES: AlarmClosedBy[] = ['all_exited', 'button', 'cli', 'timeout'];
  let pastOccurrences = 0;
  let closureN = 0;
  const recurring = schedules.filter((s) => s.weekday !== null);
  const flushAttendance = (attendees: Decision[]) => {
    for (const d of attendees) {
      decisions.push(d);
      sessions.push(toSession(d));
    }
  };

  for (let week = 0; week < weeks; week++) {
    for (const schedule of recurring) {
      const date = dateOf(week, schedule.weekday!);
      if (closedOn(date) || date === today) continue;
      const instance = makeInstance(schedule, date);
      if (date > today) continue;
      pastOccurrences++;
      const attendees: Decision[] = [];
      for (const studentId of assignedTo(schedule.id)) {
        const owed = owedAt(schedule.id, studentId, instance.startsAt);
        if (owed && rand() < ATTEND_PROBABILITY[profileOf(studentId)]!) {
          attendees.push(attend(instance, schedule, studentId, true));
        } else {
          decisions.push({
            studentId,
            scheduleId: schedule.id,
            instanceId: instance.id,
            date,
            weekday: schedule.weekday!,
            startSec: secondsOfDay(schedule.startTime),
            endSec: secondsOfDay(schedule.endTime),
            endsAtMs: instance.endsAt.getTime(),
            owed,
            attended: false,
          });
        }
      }
      // A student of another group comes in by hand (not owed here).
      if (
        week >= 2 &&
        week <= 7 &&
        schedule === recurring[week % recurring.length]
      ) {
        const guest = students
          .slice(0, 24)
          .find(
            (s) =>
              s.profile === 'asiduo' && !assignedTo(schedule.id).includes(s.id),
          );
        if (guest) {
          attendees.push(attend(instance, schedule, guest.id, false, true));
        }
      }
      if (attendees.length > 0 && pastOccurrences % 6 === 2) {
        overstay(instance, attendees, CLOSURES[closureN++ % CLOSURES.length]!);
      }
      flushAttendance(attendees);
    }
  }

  // The one-off group met yesterday and the reader was offline: the sessions
  // were rebuilt from its queue (source `offline`) and the local alarm timed out.
  const oneOffInstance = makeInstance(oneOff, oneOff.date!);
  const offlineSessions: AttendanceSession[] = [];
  const oneOffStudents = assignedTo(oneOff.id);
  oneOffStudents.forEach((studentId, k) => {
    const startSec = secondsOfDay(oneOff.startTime);
    const owed = true;
    if (k === 5) {
      decisions.push({
        studentId,
        scheduleId: oneOff.id,
        instanceId: oneOffInstance.id,
        date: oneOff.date!,
        weekday: weekdayOf(oneOff.date!),
        startSec,
        endSec: secondsOfDay(oneOff.endTime),
        endsAtMs: oneOffInstance.endsAt.getTime(),
        owed,
        attended: false,
      });
      return;
    }
    const d = attend(oneOffInstance, oneOff, studentId, owed);
    d.entrySource = 'offline';
    d.exitSource = 'offline';
    d.entryOffsetSec = 30 + k * 40;
    if (k === 4) {
      d.outcome = 'unregistered';
      d.exitSource = undefined;
      d.staySec = undefined;
    } else d.staySec = 2400 + k * 120;
    decisions.push(d);
    const session = toSession(d);
    sessions.push(session);
    offlineSessions.push(session);
  });
  const localAlarm: AlarmEvent = {
    id: demoId('alarm', ++alarmN),
    instanceId: oneOffInstance.id,
    startedAt: oneOffInstance.endsAt,
    endedAt: new Date(oneOffInstance.endsAt.getTime() + 900_000),
    closedBy: 'timeout',
    closedSessions: 1,
    origin: 'local',
    deviceId: DEMO_DEVICE_ID,
    deviceEventId: demoId('offline', 99),
  };
  alarms.push(localAlarm);

  // --- Device and offline events ------------------------------------------
  const lastSeen = new Date(oneOffInstance.endsAt.getTime() + 1_800_000);
  const device: DemoDevice = {
    id: DEMO_DEVICE_ID,
    name: 'Lector de muestra',
    firmwareVersion: 'sim-demo',
    lastConnectedAt: lastSeen,
    capabilities: ['offline'],
  };
  const snapshot: DemoSnapshot = {
    id: demoId('snapshot', 1),
    deviceId: DEMO_DEVICE_ID,
    scheduleId: oneOff.id,
    roster: Object.fromEntries(
      oneOffStudents.map((id, k) => [String(k + 1), id]),
    ),
    createdAt: new Date(oneOffInstance.startsAt.getTime() - 900_000),
  };
  const offlineEvents = buildOfflineEvents({
    device,
    snapshot,
    instance: oneOffInstance,
    sessions: offlineSessions,
    alarmId: localAlarm.id,
    adminId: admin.id,
    receivedAt: lastSeen,
    studentIds: oneOffStudents,
  });

  const dataset: DemoDataset = {
    seed: DEMO_SEED,
    scale: 1,
    today,
    period,
    exceptions,
    students,
    schedules,
    instances,
    assignments,
    sessions,
    alarms,
    decisions,
    panelUsers: [admin, assistant],
    adminId: admin.id,
    importedBy,
    fingerprints,
    importBatches,
    device,
    snapshots: [snapshot],
    offlineEvents,
    eventLog: [],
  };
  dataset.eventLog = buildAuditTrail(dataset, assistant, periodStart);
  return dataset;
}

const pick = <
  T extends { username: string; name: string; role: 'admin' | 'asistente' },
>(
  user: T,
) => ({ username: user.username, name: user.name, role: user.role });

interface OfflineInput {
  device: DemoDevice;
  snapshot: DemoSnapshot;
  instance: ScheduleInstance;
  sessions: AttendanceSession[];
  alarmId: string;
  adminId: string;
  receivedAt: Date;
  studentIds: string[];
}

/**
 * Eight events of the reader's queue: four applied, one informative (unknown
 * fingerprint), two waiting in "Por revisar" and one already approved by the
 * administrator. Literals come from the domain, not from here.
 */
function buildOfflineEvents(input: OfflineInput): OfflineEventRecord[] {
  const base = (n: number, ts: Date) => ({
    deviceId: input.device.id,
    id: demoId('offline', n),
    seq: n,
    ts,
    slot: null as number | null,
    snapshotId: input.snapshot.id as string | null,
    batchId: demoId('offline', 90) as string | null,
    studentId: null as string | null,
    instanceId: null as string | null,
    sessionId: null as string | null,
    alarmEventId: null as string | null,
    reviewReason: null as OfflineReviewReason | null,
    receivedAt: input.receivedAt,
    resolvedBy: null as string | null,
    resolvedAt: null as Date | null,
    resolution: null as OfflineEventRecord['resolution'],
    resolutionNote: null as string | null,
    correctedTs: null as Date | null,
  });
  const [s0, s1] = input.sessions;
  const applied = (
    n: number,
    session: AttendanceSession,
    type: 'entry' | 'exit',
    ts: Date,
    slot: number,
  ): OfflineEventRecord => ({
    ...base(n, ts),
    type,
    slot,
    outcome: 'applied',
    studentId: session.studentId,
    instanceId: input.instance.id,
    sessionId: session.id,
  });
  const events: OfflineEventRecord[] = [];
  if (s0 && s1) {
    events.push(
      applied(1, s0, 'entry', s0.enteredAt, 1),
      applied(2, s1, 'entry', s1.enteredAt, 2),
      applied(3, s0, 'exit', s0.exitedAt ?? s0.enteredAt, 1),
      applied(4, s1, 'exit', s1.exitedAt ?? s1.enteredAt, 2),
    );
  }
  const at = (minutes: number) =>
    new Date(input.instance.startsAt.getTime() + minutes * 60_000);
  events.push(
    { ...base(5, at(12)), type: 'unknown', slot: null, outcome: 'informativo' },
    {
      ...base(6, at(-40)),
      type: 'entry',
      slot: 3,
      outcome: 'por_revisar',
      reviewReason: 'OUTSIDE_WINDOW',
      studentId: input.studentIds[2] ?? null,
      instanceId: input.instance.id,
    },
    {
      ...base(7, at(20)),
      type: 'exit',
      slot: 4,
      outcome: 'por_revisar',
      reviewReason: 'EXIT_WITHOUT_ENTRY',
      studentId: input.studentIds[3] ?? null,
      instanceId: input.instance.id,
    },
    {
      ...base(8, at(5)),
      type: 'entry',
      slot: 5,
      outcome: 'aprobado',
      reviewReason: 'DUPLICATE_ENTRY',
      studentId: input.studentIds[4] ?? null,
      instanceId: input.instance.id,
      resolvedBy: input.adminId,
      resolvedAt: new Date(input.receivedAt.getTime() + 3_600_000),
      resolution: 'aprobar',
      resolutionNote: 'Verificado con el estudiante: la entrada es válida',
    },
  );
  events.push({
    ...base(99, input.instance.endsAt),
    type: 'alarm',
    outcome: 'applied',
    instanceId: input.instance.id,
    alarmEventId: input.alarmId,
  });
  return events;
}

/** Audit entries of the actions that built the sample set (ids only, no personal data). */
function buildAuditTrail(
  data: DemoDataset,
  assistant: DemoPanelUser,
  periodStart: string,
): DemoLogEntry[] {
  const log: DemoLogEntry[] = [];
  let t = fromBogota(addDays(periodStart, -10), '08:00').getTime();
  const push = (
    type: string,
    detail: Record<string, unknown>,
    actor: { type: DemoLogEntry['actorType']; id: string | null },
  ) => {
    t += 90_000;
    log.push({
      type,
      detail,
      actorType: actor.type,
      actorId: actor.id,
      createdAt: new Date(t),
    });
  };
  const admin = { type: 'user' as const, id: data.adminId };
  push('period.created', { periodId: data.period.id }, admin);
  for (const schedule of data.schedules) {
    push('schedule.created', { scheduleId: schedule.id }, admin);
  }
  push(
    'students.imported',
    {
      batchId: data.importBatches[0]!.id,
      total: 8,
      valid: 6,
      errors: 2,
    },
    admin,
  );
  for (const student of data.students) {
    if (student.anonymizedAt) continue;
    push('student.created', { studentId: student.id }, admin);
    if (student.consented) {
      push(
        'student.consent_recorded',
        { studentId: student.id, version: student.consentVersion },
        admin,
      );
    }
  }
  const device = data.device;
  for (const fp of data.fingerprints) {
    push(
      'enrollment.started',
      { studentId: fp.studentId, deviceId: device.id },
      { type: 'user', id: assistant.id },
    );
  }
  for (const session of data.sessions) {
    if (session.entrySource === 'manual') {
      push(
        'attendance.manual',
        {
          kind: 'entry',
          sessionId: session.id,
          studentId: session.studentId,
          instanceId: session.instanceId,
        },
        { type: 'user', id: assistant.id },
      );
    }
  }
  for (const alarm of data.alarms) {
    if (alarm.closedBy === 'button')
      push(
        'alarm.button_off',
        { events: 1, sessionsClosed: alarm.closedSessions },
        { type: 'device', id: device.id },
      );
    if (alarm.closedBy === 'cli')
      push(
        'alarm.manual_off',
        { events: 1, sessionsClosed: alarm.closedSessions },
        { type: 'system', id: null },
      );
  }
  const resolved = data.offlineEvents.find((e) => e.resolution !== null);
  if (resolved) {
    push(
      'offline.review.resolved',
      {
        eventId: resolved.id,
        deviceId: resolved.deviceId,
        action: 'aprobar',
        reviewReason: resolved.reviewReason,
        note: resolved.resolutionNote,
        sessionId: resolved.sessionId,
      },
      admin,
    );
  }
  push('student.erased', { studentId: data.students[29]!.id }, admin);
  return log;
}
