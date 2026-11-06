import type { SeedDataset } from './semester.js';

/**
 * Independent oracle (E23-10): the figures the reports must show, computed
 * with plain loops from the generator's own record of decisions and alarms.
 * It does not import the report code under test, so agreement between the two
 * is a real cross-check of the definitions.
 */

export interface ExpectedFilter {
  /** Bogota dates, inclusive; default = the whole semester. */
  from?: string;
  to?: string;
  scheduleId?: string;
  program?: string;
  studentId?: string;
}

export interface CountPair {
  obligations: number;
  attended: number;
}

export interface Expected {
  flow: {
    total: number;
    distinctStudents: number;
    byHour: number[];
    byWeekday: number[];
    peakHours: { hour: number; count: number }[];
  };
  attendance: {
    obligations: number;
    attended: number;
    byStudent: Record<string, CountPair>;
    bySchedule: Record<string, CountPair>;
    byMonth: Record<string, CountPair>;
  };
  stay: Record<
    string,
    {
      closed: number;
      average: number | null;
      unregistered: number;
      open: number;
    }
  >;
  late: Record<
    string,
    {
      entries: number;
      late: number;
      averageDelay: number | null;
      manual: number;
    }
  >;
  alarms: {
    total: number;
    closed: number;
    open: number;
    closedSessions: number;
    totalMinutes: number;
    byClosure: Record<string, number>;
  };
  quality: {
    total: number;
    manualEntry: number;
    manualExit: number;
    unregistered: number;
    staleOpen: number;
  };
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

export function expectedFor(
  data: SeedDataset,
  now: Date,
  filter: ExpectedFilter = {},
): Expected {
  const from = filter.from ?? data.period.startDate;
  const to = filter.to ?? data.period.endDate;
  const program = new Map(data.students.map((s) => [s.id, s.program]));
  const keep = (d: { studentId: string; scheduleId: string; date: string }) =>
    d.date >= from &&
    d.date <= to &&
    (!filter.scheduleId || d.scheduleId === filter.scheduleId) &&
    (!filter.studentId || d.studentId === filter.studentId) &&
    (!filter.program ||
      (program.get(d.studentId) ?? '').toLowerCase() ===
        filter.program.toLowerCase());
  const decisions = data.decisions.filter(keep);

  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const students = new Set<string>();
  const attendance: Expected['attendance'] = {
    obligations: 0,
    attended: 0,
    byStudent: {},
    bySchedule: {},
    byMonth: {},
  };
  const stay: Expected['stay'] = {};
  const stayMinutes: Record<string, number> = {};
  const late: Expected['late'] = {};
  const lateMinutes: Record<string, number> = {};
  const quality = {
    total: 0,
    manualEntry: 0,
    manualExit: 0,
    unregistered: 0,
    staleOpen: 0,
  };
  const bump = (
    map: Record<string, CountPair>,
    key: string,
    attended: boolean,
  ) => {
    const pair = (map[key] ??= { obligations: 0, attended: 0 });
    pair.obligations++;
    if (attended) pair.attended++;
  };

  for (const d of decisions) {
    const finished = d.endsAtMs <= now.getTime();
    if (d.owed && finished) {
      attendance.obligations++;
      if (d.attended) attendance.attended++;
      bump(attendance.byStudent, d.studentId, d.attended);
      bump(attendance.bySchedule, d.scheduleId, d.attended);
      bump(attendance.byMonth, d.date.slice(0, 7), d.attended);
    }
    if (!d.attended) continue;

    const entrySec = d.startSec + (d.entryOffsetSec ?? 0);
    byHour[Math.floor(entrySec / 3600)]!++;
    byWeekday[d.weekday - 1]!++;
    students.add(d.studentId);

    const st = (stay[d.studentId] ??= {
      closed: 0,
      average: null,
      unregistered: 0,
      open: 0,
    });
    if (d.outcome === 'closed') {
      st.closed++;
      stayMinutes[d.studentId] =
        (stayMinutes[d.studentId] ?? 0) + (d.staySec ?? 0) / 60;
    } else if (d.outcome === 'unregistered') st.unregistered++;
    else st.open++;

    const lt = (late[d.studentId] ??= {
      entries: 0,
      late: 0,
      averageDelay: null,
      manual: 0,
    });
    if (d.entrySource === 'manual') lt.manual++;
    else {
      lt.entries++;
      const minutes = Math.floor(Math.max(0, d.entryOffsetSec ?? 0) / 60);
      if (minutes >= 1) {
        lt.late++;
        lateMinutes[d.studentId] = (lateMinutes[d.studentId] ?? 0) + minutes;
      }
    }

    quality.total++;
    if (d.entrySource === 'manual') quality.manualEntry++;
    if (d.outcome === 'closed' && d.exitSource === 'manual')
      quality.manualExit++;
    if (d.outcome === 'unregistered') quality.unregistered++;
    if (d.outcome === 'open' && finished) quality.staleOpen++;
  }
  for (const [id, st] of Object.entries(stay)) {
    if (st.closed > 0) st.average = round1((stayMinutes[id] ?? 0) / st.closed);
  }
  for (const [id, lt] of Object.entries(late)) {
    if (lt.late > 0) lt.averageDelay = round1((lateMinutes[id] ?? 0) / lt.late);
  }

  const instanceById = new Map(data.instances.map((i) => [i.id, i]));
  const alarms: Expected['alarms'] = {
    total: 0,
    closed: 0,
    open: 0,
    closedSessions: 0,
    totalMinutes: 0,
    byClosure: { all_exited: 0, button: 0, cli: 0, timeout: 0 },
  };
  let alarmMinutes = 0;
  for (const alarm of data.alarms) {
    const instance = instanceById.get(alarm.instanceId)!;
    if (instance.date < from || instance.date > to) continue;
    if (filter.scheduleId && instance.scheduleId !== filter.scheduleId)
      continue;
    alarms.total++;
    alarms.closedSessions += alarm.closedSessions;
    if (alarm.endedAt === null) {
      alarms.open++;
      continue;
    }
    alarms.closed++;
    alarmMinutes +=
      (alarm.endedAt.getTime() - alarm.startedAt.getTime()) / 60_000;
    alarms.byClosure[alarm.closedBy!]!++;
  }
  alarms.totalMinutes = round1(alarmMinutes);

  const peakHours = byHour
    .map((count, hour) => ({ hour, count }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count || a.hour - b.hour)
    .slice(0, 3);

  return {
    flow: {
      total: byHour.reduce((a, b) => a + b, 0),
      distinctStudents: students.size,
      byHour,
      byWeekday,
      peakHours,
    },
    attendance,
    stay,
    late,
    alarms,
    quality,
  };
}

/** The headline figures of a dataset, versioned as `semester.expected.json`. */
export function keyFigures(data: SeedDataset, now: Date) {
  const e = expectedFor(data, now);
  const scheduleName = new Map(data.schedules.map((s) => [s.id, s.name]));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const percent = (part: number, whole: number) =>
    whole === 0 ? null : Math.round((part * 1000) / whole) / 10;
  return {
    seed: data.seed,
    scale: data.scale,
    now: now.toISOString(),
    period: `${data.period.startDate} .. ${data.period.endDate}`,
    students: data.students.length,
    schedules: data.schedules.length,
    instances: data.instances.length,
    sessions: data.sessions.length,
    alarmEvents: data.alarms.length,
    flow: {
      entries: e.flow.total,
      distinctStudents: e.flow.distinctStudents,
      peakHours: e.flow.peakHours,
      byWeekday: e.flow.byWeekday,
    },
    attendance: {
      obligations: e.attendance.obligations,
      attended: e.attendance.attended,
      absences: e.attendance.obligations - e.attendance.attended,
      compliancePercent: percent(
        e.attendance.attended,
        e.attendance.obligations,
      ),
      bySchedule: Object.fromEntries(
        Object.entries(e.attendance.bySchedule)
          .map(([id, p]) => [scheduleName.get(id)!, p] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      byMonth: e.attendance.byMonth,
    },
    stay: {
      closed: sum(Object.values(e.stay).map((s) => s.closed)),
      unregistered: sum(Object.values(e.stay).map((s) => s.unregistered)),
      open: sum(Object.values(e.stay).map((s) => s.open)),
    },
    late: {
      fingerprintEntries: sum(Object.values(e.late).map((s) => s.entries)),
      lateArrivals: sum(Object.values(e.late).map((s) => s.late)),
      manualEntries: sum(Object.values(e.late).map((s) => s.manual)),
    },
    alarms: e.alarms,
    quality: e.quality,
  };
}
