import { describe, expect, it } from 'vitest';
import {
  ReportFilterError,
  daysInRange,
  resolveFilters,
  selectStudentIds,
} from './filters.js';

const PERIOD = { startDate: '2026-02-02', endDate: '2026-05-29' };

describe('resolveFilters', () => {
  it('defaults to the active period', () => {
    expect(resolveFilters({}, PERIOD, '2026-03-10')).toEqual({
      from: '2026-02-02',
      to: '2026-05-29',
    });
  });

  it('defaults to the last 30 days without a period', () => {
    expect(resolveFilters({}, null, '2026-03-10')).toEqual({
      from: '2026-02-09',
      to: '2026-03-10',
    });
  });

  it('accepts exactly 366 days and rejects 367', () => {
    expect(daysInRange('2025-01-01', '2026-01-01')).toBe(366);
    expect(() =>
      resolveFilters(
        { from: '2025-01-01', to: '2026-01-01' },
        null,
        '2026-02-01',
      ),
    ).not.toThrow();
    expect(() =>
      resolveFilters(
        { from: '2025-01-01', to: '2026-01-02' },
        null,
        '2026-02-01',
      ),
    ).toThrow(expect.objectContaining({ code: 'RANGE_TOO_WIDE' }));
  });

  it.each([
    [{ from: '2026-03-02', to: '2026-03-01' }],
    [{ from: '2026-02-30' }],
    [{ to: 'ayer' }],
  ])('rejects an invalid range %j', (raw) => {
    expect(() => resolveFilters(raw, null, '2026-03-10')).toThrow(
      ReportFilterError,
    );
  });

  it('keeps the other filters', () => {
    expect(
      resolveFilters(
        { from: '2026-03-02', to: '2026-03-02', program: 'X', scheduleId: 's' },
        null,
        '2026-03-10',
      ),
    ).toEqual({
      from: '2026-03-02',
      to: '2026-03-02',
      program: 'X',
      scheduleId: 's',
    });
  });
});

describe('selectStudentIds', () => {
  const students = [
    { id: 'a', program: 'Ingeniería de Sistemas' },
    { id: 'b', program: 'ingenieria de sistemas' },
    { id: 'c', program: 'Medicina' },
    { id: 'd', program: null },
  ];

  it('does not restrict without program or student', () => {
    expect(selectStudentIds(students, {})).toBeNull();
  });

  it('matches the program ignoring case and accents, exactly', () => {
    expect(
      selectStudentIds(students, { program: 'INGENIERÍA DE SISTEMAS' }),
    ).toEqual(new Set(['a', 'b']));
    expect(selectStudentIds(students, { program: 'Ingeniería' })).toEqual(
      new Set(),
    );
  });

  it('intersects program and student', () => {
    expect(
      selectStudentIds(students, { program: 'Medicina', studentId: 'a' }),
    ).toEqual(new Set());
    expect(selectStudentIds(students, { studentId: 'd' })).toEqual(
      new Set(['d']),
    );
  });
});
