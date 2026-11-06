import { describe, expect, it } from 'vitest';
import { at } from './domain/fixtures.js';
import { expectedFor } from './seed/expected.js';
import { buildSemester } from './seed/semester.js';
import { buildReportsFixture } from './testing.js';

const dataset = buildSemester();

async function summaryAt(day: string, time = '12:00') {
  const now = at(day, time);
  const fixture = buildReportsFixture({ dataset, now });
  return { now, fixture, summary: await fixture.reports.summary() };
}

describe('administrator summary (E24-5)', () => {
  it('counts the day, the week (Monday to today) and the period from finished occurrences', async () => {
    const { now, summary } = await summaryAt('2026-03-11'); // Wednesday
    expect(summary).toMatchObject({
      date: '2026-03-11',
      weekStart: '2026-03-09',
    });
    for (const [part, from, to] of [
      [summary.today, '2026-03-11', '2026-03-11'],
      [summary.week, '2026-03-09', '2026-03-11'],
      [summary.period, '2026-02-02', '2026-03-11'],
    ] as const) {
      const e = expectedFor(dataset, now, { from, to });
      expect(part).toMatchObject({
        obligations: e.attendance.obligations,
        attended: e.attendance.attended,
        entries: e.flow.total,
      });
    }
    expect(summary.period).toMatchObject({
      name: 'Simulación 2026-1 (semilla)',
    });
    expect(summary.today.obligations).toBeGreaterThan(0);
  });

  it('on a Monday the week starts that same day', async () => {
    const { summary } = await summaryAt('2026-03-16');
    expect(summary.weekStart).toBe('2026-03-16');
  });

  it('on a Sunday the week still starts on the previous Monday', async () => {
    const { summary } = await summaryAt('2026-03-15');
    expect(summary.weekStart).toBe('2026-03-09');
    expect(summary.today).toMatchObject({
      obligations: 0,
      attended: 0,
      compliance: null,
    });
  });

  it('on a day without service nobody owes anything', async () => {
    const { summary } = await summaryAt('2026-03-23', '23:00');
    expect(summary.today).toMatchObject({
      entries: 0,
      obligations: 0,
      compliance: null,
    });
    expect(summary.week.obligations).toBe(0);
    expect(summary.period!.obligations).toBeGreaterThan(0);
  });

  it('after the period ended the period figures stop at its last day', async () => {
    const { now, summary } = await summaryAt('2026-06-10');
    const e = expectedFor(dataset, now);
    expect(summary.period).toMatchObject({
      obligations: e.attendance.obligations,
      attended: e.attendance.attended,
    });
  });

  it('raises the alerts: open session of a finished occurrence and unregistered exits of 7 days', async () => {
    const { now, summary, fixture } = await summaryAt('2026-05-15');
    expect(summary.alerts.staleOpen).toBe(1);
    const sevenDays = now.getTime() - 7 * 86_400_000;
    expect(summary.alerts.unregistered7d).toBe(
      dataset.sessions.filter(
        (s) =>
          s.status === 'no_registrada' &&
          s.enteredAt.getTime() >= sevenDays &&
          s.enteredAt <= now,
      ).length,
    );
    expect(summary.alerts.alarmOn).toBe(false);
    expect(summary.alerts.device).toEqual({ known: false, online: false });
    await fixture.markOnline('dev-1');
    expect((await fixture.reports.summary()).alerts.device).toEqual({
      known: true,
      online: true,
    });
  });

  it('without an active period returns an empty structure, not an error', async () => {
    const fixture = buildReportsFixture({ now: at('2026-03-11', '12:00') });
    const summary = await fixture.reports.summary();
    expect(summary.period).toBeNull();
    expect(summary.today).toMatchObject({
      entries: 0,
      obligations: 0,
      inside: 0,
    });
    expect(summary.alerts).toMatchObject({ staleOpen: 0, unregistered7d: 0 });
  });
});
