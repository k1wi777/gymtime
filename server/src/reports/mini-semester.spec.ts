import { describe, expect, it } from 'vitest';
import { at } from './domain/fixtures.js';
import { seedId, type SeedDataset, type SeedStudent } from './seed/semester.js';
import { buildReportsFixture } from './testing.js';

/**
 * Mini-semester with the figures worked out by hand (E23-1, B10): three
 * students, one Monday 06:00-07:00 schedule, two weeks. "Now" is Tuesday
 * 2026-03-10 12:00, so both Mondays are over.
 *
 *   Ana  owes W1 and W2. W1: in 06:00:59 (device), out 06:50:00. W2: absent.
 *   Beto owes W1 and W2. W1: in 06:03, out 06:53. W2: in 05:58, out 06:58.
 *   Carla is assigned on W2 at 06:30 (after it started): owes nothing. Manual
 *         entry W2 06:20, never left: alarm at 07:00, closed by timeout 07:15.
 *
 *   Obligations 4, attended 3 -> 75,0 %. Ana 1/2 = 50 %, Beto 2/2 = 100 %.
 *   Entries 4: hour 5 -> 1 (Beto W2), hour 6 -> 3. All on Monday (weekday 1).
 *   Stay: Ana 49:01 -> 49,0 min; Beto (50 + 60) / 2 = 55,0; Carla none, 1 unregistered.
 *   Late (device only): Ana 1 entry, 0 late (59 s is not a minute); Beto 2
 *         entries, 1 late (3 min) -> 50 %, 3,0 min; Carla 0 entries, 1 manual.
 *   Alarms: 1, closed by timeout, 15,0 min, 1 session closed.
 *   Quality: 4 sessions, 1 manual entry, 0 manual exit, 1 unregistered.
 */
const W1 = '2026-03-02';
const W2 = '2026-03-09';
const student = (n: number, name: string, program: string): SeedStudent => ({
  id: seedId('student', n),
  document: `SIM-${n}`,
  name,
  program,
  email: null,
  phone: null,
  displayName: name,
  active: true,
  consented: true,
  consentVersion: 'v1-provisional',
  consentAt: null,
  profile: 'regular',
});
const [ANA, BETO, CARLA] = [
  student(1, 'Ana', 'Ingeniería'),
  student(2, 'Beto', 'Ingeniería'),
  student(3, 'Carla', 'Enfermería'),
] as const;
const SCHEDULE = seedId('schedule', 1);
const PERIOD = seedId('period', 1);
const instance = (n: number, date: string) => ({
  id: seedId('instance', n),
  scheduleId: SCHEDULE,
  date,
  startsAt: at(date, '06:00'),
  endsAt: at(date, '07:00'),
  status: 'scheduled',
});
const session = (
  n: number,
  who: SeedStudent,
  instanceN: number,
  date: string,
  inAt: string,
  outAt: string | null,
  extra: Partial<SeedDataset['sessions'][number]> = {},
) => ({
  id: seedId('session', n),
  studentId: who.id,
  instanceId: seedId('instance', instanceN),
  enteredAt: at(date, inAt),
  exitedAt: outAt ? at(date, outAt) : null,
  entrySource: 'device' as const,
  exitSource: outAt ? ('device' as const) : null,
  status: outAt ? ('cerrada' as const) : ('abierta' as const),
  manualReason: null,
  ...extra,
});
const assign = (n: number, who: SeedStudent, from: Date) => ({
  id: seedId('assignment', n),
  scheduleId: SCHEDULE,
  studentId: who.id,
  validFrom: from,
  validTo: null,
});

const mini: SeedDataset = {
  seed: 0,
  scale: 1,
  period: {
    id: PERIOD,
    name: 'Mini',
    startDate: '2026-03-02',
    endDate: '2026-03-13',
    active: true,
  },
  exceptions: [],
  students: [ANA, BETO, CARLA],
  schedules: [
    {
      id: SCHEDULE,
      name: 'Lunes 06:00',
      weekday: 1,
      date: null,
      startTime: '06:00:00',
      endTime: '07:00:00',
      entryOpenMinutes: null,
      entryCloseMinutes: null,
      periodId: PERIOD,
    },
  ],
  instances: [instance(1, W1), instance(2, W2)],
  assignments: [
    assign(1, ANA, at('2026-03-01', '00:00')),
    assign(2, BETO, at('2026-03-01', '00:00')),
    assign(3, CARLA, at(W2, '06:30')),
  ],
  sessions: [
    session(1, ANA, 1, W1, '06:00:59', '06:50:00'),
    session(2, BETO, 1, W1, '06:03:00', '06:53:00'),
    session(3, BETO, 2, W2, '05:58:00', '06:58:00'),
    session(4, CARLA, 2, W2, '06:20:00', null, {
      entrySource: 'manual',
      status: 'no_registrada',
      manualReason: 'timeout',
    }),
  ],
  alarms: [
    {
      id: seedId('alarm', 1),
      instanceId: seedId('instance', 2),
      startedAt: at(W2, '07:00'),
      endedAt: at(W2, '07:15'),
      closedBy: 'timeout',
      closedSessions: 1,
    },
  ],
  decisions: [],
};

describe('mini-semester (hand-calculated)', () => {
  const fixture = () =>
    buildReportsFixture({ dataset: mini, now: at('2026-03-10', '12:00') });
  const rowOf = (rows: Record<string, unknown>[], name: string) =>
    rows.find((r) => r.group === name);

  it('flow: 4 entries, hour 6 is the peak, all on Monday', async () => {
    const flow = await fixture().reports.flow({});
    expect(flow.total).toBe(4);
    expect(flow.byHour[5]!.count).toBe(1);
    expect(flow.byHour[6]!.count).toBe(3);
    expect(flow.byWeekday.map((b) => b.count)).toEqual([4, 0, 0, 0, 0, 0, 0]);
    expect(flow.peaks.hours[0]).toEqual({ hour: 6, count: 3 });
  });

  it('attendance: 3 of 4 (75 %), Carla owes nothing and does not appear', async () => {
    const t = await fixture().reports.attendanceReport({});
    expect(t.rows).toHaveLength(2);
    expect(rowOf(t.rows, 'Ana')).toMatchObject({
      obligations: 2,
      attended: 1,
      absences: 1,
      compliance: 50,
    });
    expect(rowOf(t.rows, 'Beto')).toMatchObject({
      obligations: 2,
      attended: 2,
      compliance: 100,
    });
    expect(t.meta).toMatchObject({ obligations: 4, attended: 3 });
  });

  it('stay, late arrivals, alarms and quality', async () => {
    const { reports } = fixture();
    const stay = await reports.stay({});
    expect(rowOf(stay.rows, 'Ana')).toMatchObject({ closed: 1, average: 49 });
    expect(rowOf(stay.rows, 'Beto')).toMatchObject({ closed: 2, average: 55 });
    expect(rowOf(stay.rows, 'Carla')).toMatchObject({
      closed: 0,
      average: null,
      unregistered: 1,
    });
    const late = await reports.late({});
    expect(rowOf(late.rows, 'Ana')).toMatchObject({ entries: 1, late: 0 });
    expect(rowOf(late.rows, 'Beto')).toMatchObject({
      entries: 2,
      late: 1,
      lateShare: 50,
      averageDelay: 3,
    });
    expect(rowOf(late.rows, 'Carla')).toMatchObject({ entries: 0, manual: 1 });
    const alarms = await reports.alarms({});
    expect(alarms.summary).toMatchObject({
      total: 1,
      closed: 1,
      open: 0,
      totalMinutes: 15,
      closedSessions: 1,
    });
    expect(alarms.summary.byClosure.timeout).toBe(1);
    const quality = await reports.quality({});
    expect(quality.rows.map((r) => r.count)).toEqual([1, 0, 1, 0]);
    expect(quality.meta.total).toBe(4);
  });

  it('with "now" before the second Monday ended, W2 owes nothing yet', async () => {
    const early = buildReportsFixture({ dataset: mini, now: at(W2, '06:30') });
    const t = await early.reports.attendanceReport({});
    expect(t.meta).toMatchObject({ obligations: 2, attended: 2 });
  });
});
