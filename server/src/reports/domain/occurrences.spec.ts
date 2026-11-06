import { describe, expect, it } from 'vitest';
import { computeObligations, isFinished, validAt } from './occurrences.js';
import { at, instance, interval } from './fixtures.js';

const NEVER_CLOSED = () => false;
const NOW = at('2026-03-30', '12:00');

describe('validAt (validity evaluated at the start of the occurrence)', () => {
  const start = at('2026-03-02', '06:00');

  it('counts an interval that starts exactly at the start', () => {
    expect(validAt([interval('a', start)], start)).toBe(true);
  });

  it('does not count an interval that starts one second after', () => {
    expect(
      validAt([interval('a', new Date(start.getTime() + 1000))], start),
    ).toBe(false);
  });

  it('does not count an interval that closed exactly at the start', () => {
    expect(
      validAt([interval('a', at('2026-01-01', '00:00'), start)], start),
    ).toBe(false);
  });

  it('still counts someone unassigned after the start', () => {
    const closed = new Date(start.getTime() + 30 * 60_000);
    expect(
      validAt([interval('a', at('2026-01-01', '00:00'), closed)], start),
    ).toBe(true);
  });

  it('counts with two intervals if one of them covers it', () => {
    const intervals = [
      interval('a', at('2026-01-01', '00:00'), at('2026-02-01', '00:00')),
      interval('a', at('2026-02-20', '00:00')),
    ];
    expect(validAt(intervals, start)).toBe(true);
    expect(validAt(intervals, at('2026-02-10', '06:00'))).toBe(false);
  });
});

describe('computeObligations', () => {
  const occurrences = [
    instance('i1', '2026-03-02'),
    instance('i2', '2026-03-09'),
    instance('i3', '2026-03-16'),
  ];
  const base = {
    occurrences,
    assignments: [interval('ana', at('2026-03-01', '00:00'))],
    closedOn: NEVER_CLOSED,
    now: NOW,
    studentIds: null,
  };

  it('owes every finished occurrence of an assigned student', () => {
    expect(computeObligations(base).map((o) => o.instance.id)).toEqual([
      'i1',
      'i2',
      'i3',
    ]);
  });

  it('skips future and in-progress occurrences (endsAt <= now is finished)', () => {
    const now = at('2026-03-09', '07:00');
    expect(isFinished(occurrences[1]!, now)).toBe(true);
    expect(
      computeObligations({ ...base, now }).map((o) => o.instance.id),
    ).toEqual(['i1', 'i2']);
    expect(
      computeObligations({ ...base, now: at('2026-03-09', '06:59:59') }).map(
        (o) => o.instance.id,
      ),
    ).toEqual(['i1']);
  });

  it('skips days without service even if sessions exist there', () => {
    const closedOn = (_: string, date: string) => date === '2026-03-09';
    expect(
      computeObligations({ ...base, closedOn }).map((o) => o.instance.id),
    ).toEqual(['i1', 'i3']);
  });

  it('skips occurrences before the validity and after it closed', () => {
    const assignments = [
      interval('ana', at('2026-03-09', '06:00'), at('2026-03-16', '06:00')),
    ];
    expect(
      computeObligations({ ...base, assignments }).map((o) => o.instance.id),
    ).toEqual(['i2']);
  });

  it('restricts to the requested students', () => {
    const assignments = [
      interval('ana', at('2026-03-01', '00:00')),
      interval('beto', at('2026-03-01', '00:00')),
    ];
    const result = computeObligations({
      ...base,
      assignments,
      studentIds: new Set(['beto']),
    });
    expect(new Set(result.map((o) => o.studentId))).toEqual(new Set(['beto']));
    expect(result).toHaveLength(3);
  });
});
