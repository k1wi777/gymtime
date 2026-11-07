import { describe, expect, it } from 'vitest';
import { fromBogota } from '../common/time/bogota.js';
import { expectedFor } from '../reports/seed/expected.js';
import { buildReportsFixture } from '../reports/testing.js';
import { OFFLINE_OUTCOMES } from '../offline/domain/offline-event.js';
import {
  DEMO_COUNTS,
  DEMO_DOCUMENT_PREFIX,
  DEMO_USERS,
  buildDemoDataset,
} from './dataset.js';
import { checkPassword } from '../auth/password-policy.js';

const TODAY = '2026-11-07';
const dataset = buildDemoDataset({ today: TODAY });

describe('buildDemoDataset', () => {
  it('is deterministic for the same day and moves with the day', () => {
    expect(buildDemoDataset({ today: TODAY })).toEqual(dataset);
    const other = buildDemoDataset({ today: '2026-11-14' });
    expect(other.period.startDate).not.toBe(dataset.period.startDate);
  });

  it('has the counts the documentation quotes', () => {
    expect(dataset.students).toHaveLength(DEMO_COUNTS.students);
    expect(dataset.fingerprints).toHaveLength(DEMO_COUNTS.withFingerprint);
    expect(
      dataset.students.filter((s) => s.active && s.consented),
    ).toHaveLength(24);
    expect(
      dataset.students.filter((s) => !s.active && !s.anonymizedAt),
    ).toHaveLength(2);
    expect(
      dataset.students.filter((s) => s.active && !s.consented),
    ).toHaveLength(3);
    expect(dataset.students.filter((s) => s.anonymizedAt)).toHaveLength(1);
    expect(dataset.schedules.filter((s) => s.weekday !== null)).toHaveLength(4);
    expect(dataset.schedules.filter((s) => s.date !== null)).toHaveLength(1);
  });

  it('fills every field of the students that are not erased', () => {
    for (const s of dataset.students.filter((x) => !x.anonymizedAt)) {
      expect(s.document.startsWith(DEMO_DOCUMENT_PREFIX), s.document).toBe(
        true,
      );
      for (const field of [
        'name',
        'program',
        'email',
        'phone',
        'displayName',
      ] as const) {
        expect(s[field], `${s.document} ${field}`).toBeTruthy();
      }
      expect(s.displayName).toMatch(/^[\x20-\x7e]{1,16}$/);
      expect(s.consentVersion !== null).toBe(s.consented);
    }
    const erased = dataset.students.find((s) => s.anonymizedAt)!;
    expect(erased).toMatchObject({
      active: false,
      program: null,
      email: null,
      phone: null,
    });
    expect(dataset.fingerprints.map((f) => f.studentId)).not.toContain(
      erased.id,
    );
  });

  it('has a period around today with days without service in the past and the future', () => {
    const { period, exceptions } = dataset;
    expect(period.startDate <= TODAY && TODAY <= period.endDate).toBe(true);
    expect(exceptions.some((e) => e.to < TODAY)).toBe(true);
    expect(exceptions.some((e) => e.from > TODAY)).toBe(true);
    for (const e of exceptions) {
      expect(period.startDate <= e.from && e.to <= period.endDate).toBe(true);
      const hits = dataset.instances.filter((i) => {
        const schedule = dataset.schedules.find((s) => s.id === i.scheduleId)!;
        return schedule.periodId !== null && e.from <= i.date && i.date <= e.to;
      });
      expect(hits, e.reason).toHaveLength(0);
    }
  });

  it('never opens a session nor records attendance for today or the future', () => {
    expect(dataset.sessions.every((s) => s.status !== 'abierta')).toBe(true);
    const byInstance = new Map(dataset.instances.map((i) => [i.id, i]));
    for (const s of dataset.sessions) {
      expect(byInstance.get(s.instanceId)!.date < TODAY).toBe(true);
    }
    expect(dataset.instances.some((i) => i.date > TODAY)).toBe(true);
    expect(dataset.instances.some((i) => i.date === TODAY)).toBe(false);
  });

  it('has no overlapping validity intervals for a student in a schedule', () => {
    const groups = new Map<string, typeof dataset.assignments>();
    for (const a of dataset.assignments) {
      const key = `${a.scheduleId}|${a.studentId}`;
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    for (const [key, list] of groups) {
      const sorted = [...list].sort(
        (a, b) => a.validFrom.getTime() - b.validFrom.getTime(),
      );
      sorted.forEach((a, k) => {
        if (k === 0) return;
        const previous = sorted[k - 1]!;
        expect(previous.validTo, key).not.toBeNull();
        expect(previous.validTo!.getTime() <= a.validFrom.getTime(), key).toBe(
          true,
        );
      });
      expect(list.filter((a) => a.validTo === null).length).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it('covers every kind of session, manual entry and alarm the panel shows', () => {
    expect(new Set(dataset.alarms.map((a) => a.closedBy))).toEqual(
      new Set(['all_exited', 'button', 'cli', 'timeout']),
    );
    expect(dataset.alarms.some((a) => a.origin === 'local')).toBe(true);
    expect(dataset.sessions.some((s) => s.status === 'no_registrada')).toBe(
      true,
    );
    expect(
      dataset.sessions.some(
        (s) => s.entrySource === 'manual' && s.manualReason,
      ),
    ).toBe(true);
    expect(dataset.sessions.some((s) => s.entrySource === 'offline')).toBe(
      true,
    );
    expect(dataset.decisions.some((d) => d.owed && !d.attended)).toBe(true);
  });

  it('has offline events with every outcome the review screen needs', () => {
    const outcomes = dataset.offlineEvents.map((e) => e.outcome);
    for (const o of outcomes) expect(OFFLINE_OUTCOMES).toContain(o);
    expect(
      outcomes.filter((o) => o === 'por_revisar').length,
    ).toBeGreaterThanOrEqual(2);
    expect(outcomes).toContain('aprobado');
    expect(outcomes).toContain('applied');
    const resolved = dataset.offlineEvents.find(
      (e) => e.outcome === 'aprobado',
    )!;
    expect(resolved.resolvedBy).toBe(dataset.adminId);
    const ids = dataset.offlineEvents.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('audits with ids only: no names, documents, emails or phones', () => {
    const text = JSON.stringify(dataset.eventLog);
    for (const s of dataset.students) {
      expect(text).not.toContain(s.document);
      expect(text).not.toContain(s.email ?? '@@');
    }
    expect(dataset.eventLog.length).toBeGreaterThan(60);
  });

  it('gives the sample accounts passwords that meet the policy', () => {
    for (const user of DEMO_USERS) {
      expect(checkPassword(user.password, user.username)).toBeNull();
    }
    expect(dataset.panelUsers.map((u) => u.role).sort()).toEqual([
      'admin',
      'asistente',
    ]);
  });
});

describe('the sample set in the reports (R18)', () => {
  const now = fromBogota(TODAY, '08:00');
  const fixture = buildReportsFixture({ now, dataset });
  const expected = expectedFor(dataset, now);
  const from = dataset.period.startDate;
  const to = TODAY;

  it('every report has data, and agrees with an independent count', async () => {
    const { reports } = fixture;
    const flow = await reports.flow({ from, to });
    expect(flow.total).toBe(expected.flow.total);
    expect(flow.total).toBeGreaterThan(50);
    expect(flow.byHour.map((b) => b.count)).toEqual(expected.flow.byHour);

    const attendance = await reports.attendanceReport({ from, to });
    expect(attendance.rows.length).toBeGreaterThan(10);
    expect(
      attendance.rows.reduce((n, r) => n + (r.obligations as number), 0),
    ).toBe(expected.attendance.obligations);
    expect(
      attendance.rows.reduce((n, r) => n + (r.attended as number), 0),
    ).toBe(expected.attendance.attended);

    for (const [name, report] of [
      ['stay', await reports.stay({ from, to })],
      ['late', await reports.late({ from, to })],
      ['alarms', await reports.alarms({ from, to })],
      ['quality', await reports.quality({ from, to })],
    ] as const) {
      expect(report.rows.length, name).toBeGreaterThan(0);
    }
    const alarms = await reports.alarms({ from, to });
    // The reader's local alarm is counted apart, not as a server alarm.
    expect(alarms.rows.length).toBe(
      dataset.alarms.filter((a) => a.origin === 'server').length,
    );
    expect(alarms.rows.length).toBe(expected.alarms.total - 1);
    const quality = await reports.quality({ from, to });
    expect(quality.meta.total).toBe(expected.quality.total);
  });

  it('attendance by month and the by-student rows agree with the oracle', async () => {
    const byStudent = await fixture.reports.attendanceReport({ from, to });
    for (const [id, pair] of Object.entries(expected.attendance.byStudent)) {
      const row = byStudent.rows.find((r) => r.id === id);
      expect(row, id).toMatchObject({
        obligations: pair.obligations,
        attended: pair.attended,
      });
    }
  });
});

describe('whatever day it is run', () => {
  it.each(
    Array.from(
      { length: 14 },
      (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`,
    ),
  )('the set is consistent and the reports agree on %s', async (today) => {
    const data = buildDemoDataset({ today });
    expect(data.period.startDate <= today && today <= data.period.endDate).toBe(
      true,
    );
    expect(data.exceptions.some((e) => e.to < today)).toBe(true);
    expect(data.exceptions.some((e) => e.from > today)).toBe(true);
    expect(data.sessions.length).toBeGreaterThan(80);
    const now = fromBogota(today, '08:00');
    const { reports } = buildReportsFixture({ now, dataset: data });
    const expected = expectedFor(data, now);
    const range = { from: data.period.startDate, to: today };
    expect((await reports.flow(range)).total).toBe(expected.flow.total);
    const attendance = await reports.attendanceReport(range);
    expect(
      attendance.rows.reduce((n, r) => n + (r.obligations as number), 0),
    ).toBe(expected.attendance.obligations);
  });
});
