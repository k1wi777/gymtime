import { describe, expect, it } from 'vitest';
import { expectedFor, type Expected } from './seed/expected.js';
import {
  MID_SEMESTER_NOW,
  SEMESTER_NOW,
  SIM_DOCUMENT_PREFIX,
  buildSemester,
} from './seed/semester.js';
import { buildReportsFixture } from './testing.js';
import type { ReportTable } from './domain/table.js';

const dataset = buildSemester();

function byId(table: ReportTable) {
  return Object.fromEntries(table.rows.map((r) => [r.id as string, r]));
}

/** Compares a report with the oracle, row by row. */
async function expectReportsMatch(
  fixture: ReturnType<typeof buildReportsFixture>,
  expected: Expected,
  query: Record<string, string> = {},
) {
  const { reports } = fixture;
  const flow = await reports.flow(query);
  expect(flow.total).toBe(expected.flow.total);
  expect(flow.distinctStudents).toBe(expected.flow.distinctStudents);
  expect(flow.byHour.map((b) => b.count)).toEqual(expected.flow.byHour);
  expect(flow.byWeekday.map((b) => b.count)).toEqual(expected.flow.byWeekday);
  expect(flow.peaks.hours).toEqual(expected.flow.peakHours);

  const attendance = byId(await reports.attendanceReport(query));
  expect(Object.keys(attendance).sort()).toEqual(
    Object.keys(expected.attendance.byStudent).sort(),
  );
  for (const [id, pair] of Object.entries(expected.attendance.byStudent)) {
    expect(attendance[id], id).toMatchObject({
      obligations: pair.obligations,
      attended: pair.attended,
      absences: pair.obligations - pair.attended,
    });
  }
  const bySchedule = await reports.attendanceReport({
    ...query,
    groupBy: 'schedule',
  });
  expect(
    bySchedule.rows.reduce((n, r) => n + (r.obligations as number), 0),
  ).toBe(expected.attendance.obligations);
  const byMonth = await reports.attendanceReport({
    ...query,
    groupBy: 'month',
  });
  expect(
    Object.fromEntries(byMonth.rows.map((r) => [r.group, r.obligations])),
  ).toEqual(
    Object.fromEntries(
      Object.entries(expected.attendance.byMonth).map(([m, p]) => [
        m,
        p.obligations,
      ]),
    ),
  );

  const stay = byId(await reports.stay(query));
  for (const [id, row] of Object.entries(expected.stay)) {
    expect(stay[id], id).toMatchObject({
      closed: row.closed,
      average: row.average,
      unregistered: row.unregistered,
      open: row.open,
    });
  }
  const late = byId(await reports.late(query));
  for (const [id, row] of Object.entries(expected.late)) {
    expect(late[id], id).toMatchObject({
      entries: row.entries,
      late: row.late,
      averageDelay: row.averageDelay,
      manual: row.manual,
    });
  }

  const quality = await reports.quality(query);
  expect(quality.rows.map((r) => r.count)).toEqual([
    expected.quality.manualEntry,
    expected.quality.manualExit,
    expected.quality.unregistered,
    expected.quality.staleOpen,
  ]);
  expect(quality.meta.total).toBe(expected.quality.total);
}

describe('simulated semester: reports agree with the oracle', () => {
  it('whole semester at the end of the term', async () => {
    const fixture = buildReportsFixture({ dataset });
    await expectReportsMatch(fixture, expectedFor(dataset, SEMESTER_NOW));
  });

  it('halfway through the term (future and in-progress occurrences owe nothing)', async () => {
    const fixture = buildReportsFixture({
      dataset,
      now: MID_SEMESTER_NOW,
    });
    const expected = expectedFor(dataset, MID_SEMESTER_NOW);
    expect(expected.attendance.obligations).toBeLessThan(
      expectedFor(dataset, SEMESTER_NOW).attendance.obligations,
    );
    await expectReportsMatch(fixture, expected);
  });

  it('with a schedule, a degree, a month and a student filter', async () => {
    const fixture = buildReportsFixture({ dataset });
    const scheduleId = dataset.schedules[2]!.id;
    const program = dataset.students[1]!.program!;
    const filters: Record<string, string>[] = [
      { scheduleId },
      { program },
      { from: '2026-03-02', to: '2026-03-31' },
      { program, scheduleId, from: '2026-04-06', to: '2026-05-15' },
      { studentId: dataset.students[7]!.id },
    ];
    for (const filter of filters) {
      await expectReportsMatch(
        fixture,
        expectedFor(dataset, SEMESTER_NOW, filter),
        filter,
      );
    }
  });

  it('alarms: the by-closure counts plus the open ones equal the total', async () => {
    const fixture = buildReportsFixture({ dataset });
    const report = await fixture.reports.alarms({});
    const expected = expectedFor(dataset, SEMESTER_NOW).alarms;
    expect(report.summary).toMatchObject({
      total: expected.total,
      closed: expected.closed,
      open: expected.open,
      closedSessions: expected.closedSessions,
      totalMinutes: expected.totalMinutes,
      byClosure: expected.byClosure,
    });
    const s = report.summary;
    expect(Object.values(s.byClosure).reduce((a, b) => a + b, 0) + s.open).toBe(
      s.total,
    );
    expect(s.total).toBe(dataset.alarms.length);
    expect(report.rows).toHaveLength(s.total);
  });

  it('the student detail lists every owed occurrence with its result', async () => {
    const fixture = buildReportsFixture({ dataset });
    const student = dataset.students[4]!; // reassigned: two intervals
    const detail = await fixture.reports.studentDetail(student.id, {});
    const expected = expectedFor(dataset, SEMESTER_NOW, {
      studentId: student.id,
    }).attendance.byStudent[student.id]!;
    expect(detail!.rows).toHaveLength(expected.obligations);
    expect(detail!.rows.filter((r) => r.result === 'Asistió')).toHaveLength(
      expected.attended,
    );
    expect(detail!.student.name).toBe(student.name);
    expect(
      await fixture.reports.studentDetail(
        '00000000-0000-4000-8000-000000000000',
        {},
      ),
    ).toBeNull();
  });

  it('the generator is deterministic and the dataset is marked as simulated', () => {
    const again = buildSemester();
    expect(JSON.stringify(again)).toBe(JSON.stringify(dataset));
    expect(buildSemester({ seed: 1 }).sessions.length).not.toBe(0);
    expect(
      dataset.students.every((s) => s.document.startsWith(SIM_DOCUMENT_PREFIX)),
    ).toBe(true);
    expect(buildSemester({ scale: 3 }).students).toHaveLength(120);
  });
});
