import { describe, expect, it } from 'vitest';
import { computeAlarms, summarizeAlarms } from './alarms.js';
import { computeAttendance } from './attendance.js';
import { computeFlow, flowTable } from './flow.js';
import { delayMinutes, computeLate } from './late.js';
import { computeObligations } from './occurrences.js';
import { computeQuality, QUALITY_STATES } from './quality.js';
import { computeStay } from './stay.js';
import { computeStudentDetail } from './student-detail.js';
import { summarizeRange } from './summary.js';
import { percent, sortRows } from './table.js';
import {
  alarmEvent,
  at,
  context,
  instance,
  interval,
  session,
} from './fixtures.js';

const i1 = instance('i1', '2026-03-02');
const i2 = instance('i2', '2026-03-09');
const i3 = instance('i3', '2026-03-31', { start: '23:00', end: '23:59' });
const NOW = at('2026-04-02', '12:00');
const ctx = context([i1, i2, i3], NOW);

describe('flow (entries per Bogota hour and weekday)', () => {
  const sessions = [
    session({
      instanceId: 'i1',
      studentId: 'ana',
      enteredAt: at('2026-03-02', '06:00'),
    }),
    session({
      instanceId: 'i1',
      studentId: 'beto',
      enteredAt: at('2026-03-02', '06:59:59'),
    }),
    session({
      instanceId: 'i2',
      studentId: 'ana',
      enteredAt: at('2026-03-09', '07:00'),
    }),
    // 23:59 Bogota is already the next day in UTC.
    session({
      instanceId: 'i3',
      studentId: 'ana',
      enteredAt: at('2026-03-31', '23:59:30'),
    }),
  ];

  it('groups by Bogota hour and weekday, counting distinct students', () => {
    const flow = computeFlow(sessions);
    expect(flow.total).toBe(4);
    expect(flow.distinctStudents).toBe(2);
    expect(flow.byHour[6]!.count).toBe(2);
    expect(flow.byHour[7]!.count).toBe(1);
    expect(flow.byHour[23]!.count).toBe(1);
    expect(flow.byHour).toHaveLength(24);
    expect(flow.byWeekday.map((b) => b.count)).toEqual([3, 1, 0, 0, 0, 0, 0]);
  });

  it('ranks peaks by count and breaks ties toward the smaller value', () => {
    const flow = computeFlow(sessions, 3);
    expect(flow.peaks.hours).toEqual([
      { hour: 6, count: 2 },
      { hour: 7, count: 1 },
      { hour: 23, count: 1 },
    ]);
    expect(flow.peaks.dates[0]).toEqual({ date: '2026-03-02', count: 2 });
    expect(flow.peaks.dates[1]).toEqual({ date: '2026-03-09', count: 1 });
  });

  it('has zeros, not holes, and an empty range gives no peaks', () => {
    const flow = computeFlow([]);
    expect(flow.byHour.every((b) => b.count === 0)).toBe(true);
    expect(flow.peaks.hours).toEqual([]);
    expect(flowTable(flow).rows).toHaveLength(31);
  });

  it('shares in the table add up to the entries of each grouping', () => {
    const table = flowTable(computeFlow(sessions));
    const hours = table.rows.filter((r) => r.group === 'Hora');
    expect(hours.reduce((n, r) => n + (r.count as number), 0)).toBe(4);
  });
});

describe('attendance / absences / compliance', () => {
  const assignments = [
    interval('ana', at('2026-03-01', '00:00')),
    interval('beto', at('2026-03-05', '00:00')),
  ];
  const obligations = computeObligations({
    occurrences: [i1, i2, i3],
    assignments,
    closedOn: () => false,
    now: NOW,
    studentIds: null,
  });
  const sessions = [
    session({
      instanceId: 'i1',
      studentId: 'ana',
      enteredAt: at('2026-03-02', '06:00'),
    }),
    // Beto owes only i2 and i3 (joined after i1); a manual entry in i1 is no obligation.
    session({
      instanceId: 'i1',
      studentId: 'beto',
      enteredAt: at('2026-03-02', '06:10'),
      entrySource: 'manual',
    }),
    session({
      instanceId: 'i2',
      studentId: 'beto',
      enteredAt: at('2026-03-09', '06:05'),
      status: 'no_registrada',
    }),
  ];

  it('counts per student; a no_registrada is attendance; manual extras add nothing', () => {
    const t = computeAttendance(obligations, sessions, 'student', ctx);
    const row = (name: string) => t.rows.find((r) => r.group === name)!;
    expect(row('Ana')).toMatchObject({
      obligations: 3,
      attended: 1,
      absences: 2,
      compliance: 33.3,
    });
    expect(row('Beto')).toMatchObject({
      obligations: 2,
      attended: 1,
      absences: 1,
      compliance: 50,
    });
  });

  it('groups by schedule and by month', () => {
    expect(
      computeAttendance(obligations, sessions, 'schedule', ctx).rows,
    ).toMatchObject([{ group: 'Lunes 6am', obligations: 5, attended: 2 }]);
    expect(
      computeAttendance(obligations, sessions, 'month', ctx).rows,
    ).toMatchObject([{ group: '2026-03', obligations: 5, attended: 2 }]);
  });

  it('percent is null, not 0 or 100, without obligations', () => {
    expect(percent(0, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(1, 8)).toBe(12.5);
  });

  it('only counts finished occurrences', () => {
    const early = computeObligations({
      occurrences: [i1, i2, i3],
      assignments,
      closedOn: () => false,
      now: at('2026-03-09', '06:30'),
      studentIds: null,
    });
    expect(early.filter((o) => o.instance.id === 'i2')).toHaveLength(0);
  });
});

describe('stay', () => {
  it('averages closed sessions only and counts the rest apart', () => {
    const t = computeStay(
      [
        session({
          instanceId: 'i1',
          enteredAt: at('2026-03-02', '06:00'),
          exitedAt: at('2026-03-02', '06:50'),
          status: 'cerrada',
          exitSource: 'device',
        }),
        session({
          instanceId: 'i2',
          enteredAt: at('2026-03-09', '06:00'),
          exitedAt: at('2026-03-09', '06:55'),
          status: 'cerrada',
          exitSource: 'manual',
        }),
        session({
          instanceId: 'i2',
          enteredAt: at('2026-03-09', '06:00'),
          status: 'no_registrada',
        }),
        session({
          instanceId: 'i2',
          enteredAt: at('2026-03-09', '06:00'),
          status: 'abierta',
        }),
      ],
      'student',
      ctx,
    );
    expect(t.rows).toEqual([
      expect.objectContaining({
        group: 'Ana',
        closed: 2,
        average: 52.5,
        unregistered: 1,
        open: 1,
      }),
    ]);
  });

  it('has a null average without closed sessions and groups by month at the turn of the month', () => {
    const t = computeStay(
      [
        session({
          instanceId: 'i3',
          enteredAt: at('2026-03-31', '23:10'),
          status: 'no_registrada',
        }),
      ],
      'month',
      ctx,
    );
    expect(t.rows).toEqual([
      expect.objectContaining({ group: '2026-03', average: null, closed: 0 }),
    ]);
  });
});

describe('late arrivals', () => {
  const start = at('2026-03-02', '06:00');

  it('is late from one full minute: 59 s is not, 60 s is', () => {
    expect(delayMinutes(at('2026-03-02', '06:00:59'), start)).toBe(0);
    expect(delayMinutes(at('2026-03-02', '06:01:00'), start)).toBe(1);
    expect(delayMinutes(at('2026-03-02', '05:50:00'), start)).toBe(0);
  });

  it('judges only fingerprint entries and counts manual ones apart', () => {
    const t = computeLate(
      [
        session({ instanceId: 'i1', enteredAt: at('2026-03-02', '05:55') }),
        session({ instanceId: 'i1', enteredAt: at('2026-03-02', '06:00:59') }),
        session({ instanceId: 'i2', enteredAt: at('2026-03-09', '06:04') }),
        session({
          instanceId: 'i2',
          enteredAt: at('2026-03-09', '06:08'),
          entrySource: 'manual',
        }),
        session({ instanceId: 'i2', enteredAt: at('2026-03-09', '06:02') }),
      ],
      'student',
      ctx,
    );
    expect(t.rows).toEqual([
      expect.objectContaining({
        entries: 4,
        late: 2,
        lateShare: 50,
        averageDelay: 3,
        manual: 1,
      }),
    ]);
  });

  it('has a null average without late arrivals', () => {
    const t = computeLate(
      [session({ instanceId: 'i1', enteredAt: at('2026-03-02', '06:00') })],
      'schedule',
      ctx,
    );
    expect(t.rows[0]).toMatchObject({
      late: 0,
      averageDelay: null,
      lateShare: 0,
    });
  });
});

describe('alarms', () => {
  const events = [
    alarmEvent({
      id: 'a',
      startedAt: at('2026-03-02', '07:00'),
      endedAt: at('2026-03-02', '07:04'),
      closedBy: 'all_exited',
    }),
    alarmEvent({
      id: 'b',
      instanceId: 'i2',
      startedAt: at('2026-03-09', '07:00'),
      endedAt: at('2026-03-09', '07:10'),
      closedBy: 'button',
      closedSessions: 2,
    }),
    alarmEvent({
      id: 'c',
      instanceId: 'i2',
      startedAt: at('2026-03-10', '07:00'),
      endedAt: at('2026-03-10', '07:30'),
      closedBy: 'timeout',
      closedSessions: 1,
    }),
    alarmEvent({
      id: 'd',
      instanceId: 'i2',
      startedAt: at('2026-03-11', '07:00'),
    }),
  ];

  it('keeps the invariant: by-closure plus open equals the total', () => {
    const s = summarizeAlarms(events);
    expect(s.total).toBe(4);
    expect(Object.values(s.byClosure).reduce((a, b) => a + b, 0) + s.open).toBe(
      s.total,
    );
    expect(s).toMatchObject({
      closed: 3,
      open: 1,
      totalMinutes: 44,
      averageMinutes: 14.7,
      closedSessions: 3,
    });
  });

  it('lists the newest first and marks the open one', () => {
    const t = computeAlarms(events, ctx);
    expect(t.rows[0]).toMatchObject({ closedBy: 'Abierta', minutes: null });
    expect(t.summary.byClosure.cli).toBe(0);
  });

  it('is empty without events', () => {
    expect(summarizeAlarms([])).toMatchObject({
      total: 0,
      averageMinutes: null,
    });
  });
});

describe('quality', () => {
  it('counts manual entry and exit apart and open sessions of finished occurrences', () => {
    const t = computeQuality(
      [
        session({
          instanceId: 'i1',
          entrySource: 'manual',
          exitSource: 'manual',
          status: 'cerrada',
        }),
        session({ instanceId: 'i1', exitSource: 'manual', status: 'cerrada' }),
        session({ instanceId: 'i2', status: 'no_registrada' }),
        session({ instanceId: 'i3', status: 'abierta' }),
      ],
      ctx,
    );
    expect(t.rows.map((r) => r.count)).toEqual([1, 2, 1, 1]);
    expect(t.meta).toMatchObject({ total: 4, estados: [...QUALITY_STATES] });
    expect(t.rows[0]!.share).toBe(25);
  });

  it('does not flag an open session of an occurrence still running', () => {
    const running = context([i1], at('2026-03-02', '06:30'));
    const t = computeQuality(
      [session({ instanceId: 'i1', status: 'abierta' })],
      running,
    );
    expect(t.rows[3]!.count).toBe(0);
  });
});

describe('student detail and summary', () => {
  const obligations = computeObligations({
    occurrences: [i1, i2],
    assignments: [interval('ana', at('2026-03-01', '00:00'))],
    closedOn: () => false,
    now: NOW,
    studentIds: null,
  });
  const sessions = [
    session({
      instanceId: 'i1',
      enteredAt: at('2026-03-02', '06:03'),
      exitedAt: at('2026-03-02', '06:53'),
      status: 'cerrada',
      exitSource: 'device',
    }),
  ];

  it('shows each owed occurrence with its result', () => {
    const t = computeStudentDetail('ana', obligations, sessions, ctx);
    expect(t.rows).toEqual([
      expect.objectContaining({
        date: '2026-03-02',
        result: 'Asistió',
        delay: 3,
        minutes: 50,
      }),
      expect.objectContaining({
        date: '2026-03-09',
        result: 'Faltó',
        enteredAt: null,
        delay: null,
      }),
    ]);
  });

  it('summarizes a range of dates', () => {
    expect(
      summarizeRange(obligations, sessions, ctx, '2026-03-01', '2026-03-31'),
    ).toEqual({
      entries: 1,
      obligations: 2,
      attended: 1,
      compliance: 50,
    });
    expect(
      summarizeRange(obligations, sessions, ctx, '2026-04-01', '2026-04-02'),
    ).toMatchObject({
      obligations: 0,
      compliance: null,
    });
  });
});

describe('sortRows', () => {
  const columns = [
    { key: 'name', label: 'N', type: 'text' as const },
    { key: 'n', label: 'N', type: 'int' as const },
  ];
  const rows = [
    { name: 'b', n: 10 },
    { name: 'a', n: null },
    { name: 'c', n: 2 },
    { name: 'á', n: 2 },
  ];

  it('sorts numbers numerically, empty cells last in both directions, stably', () => {
    expect(sortRows(columns, rows, 'n', 'asc').map((r) => r.name)).toEqual([
      'c',
      'á',
      'b',
      'a',
    ]);
    expect(sortRows(columns, rows, 'n', 'desc').map((r) => r.name)).toEqual([
      'b',
      'c',
      'á',
      'a',
    ]);
  });

  it('sorts text with the Spanish collation and ignores unknown keys', () => {
    expect(sortRows(columns, rows, 'name').map((r) => r.name)).toEqual([
      'a',
      'á',
      'b',
      'c',
    ]);
    expect(sortRows(columns, rows, 'nope')).toEqual(rows);
  });
});
