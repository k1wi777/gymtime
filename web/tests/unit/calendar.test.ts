import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  compareDay,
  expandClosedDays,
  formatPickerDay,
  fullDayName,
  isDisabled,
  isValidDay,
  monthGrid,
  normalizeRange,
  pickRangeDay,
  rangeInstruction,
  shortcutRange,
} from '@/lib/calendar';

describe('monthGrid', () => {
  it('has 42 cells starting on Monday', () => {
    const grid = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({ iso: '2026-10-26', inMonth: false });
    expect(grid[6]).toEqual({ iso: '2026-11-01', inMonth: true });
  });
  it.each([
    [2026, 1, 28],
    [2028, 1, 29],
    [2026, 3, 30],
    [2026, 11, 31],
  ])('counts the days of %i-%i', (year, month, days) => {
    expect(monthGrid(year, month).filter((c) => c.inMonth)).toHaveLength(days);
  });
});

describe('days', () => {
  it('compares, adds and validates', () => {
    expect(compareDay('2026-11-02', '2026-11-03')).toBe(-1);
    expect(compareDay('2026-11-02', '2026-11-02')).toBe(0);
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('2026-2-3')).toBe(false);
    expect(isValidDay('2026-11-07')).toBe(true);
  });
  it('orders the ends of a range', () => {
    expect(normalizeRange('2026-11-07', '2026-11-02')).toEqual({
      from: '2026-11-02',
      to: '2026-11-07',
    });
    expect(normalizeRange('2026-11-02', '2026-11-02')).toEqual({
      from: '2026-11-02',
      to: '2026-11-02',
    });
  });
  it('names days and formats them', () => {
    expect(fullDayName('2026-11-02')).toBe('lunes 2 de noviembre de 2026');
    expect(formatPickerDay('2026-11-02')).toBe('2 nov 2026');
    expect(formatPickerDay('2026-09-07')).toBe('7 sept 2026');
  });
});

describe('bounds and closed days', () => {
  const bounds = { start: '2026-09-07', end: '2026-12-13' };
  it('disables days outside the period only', () => {
    expect(isDisabled('2026-09-06', bounds)).toBe(true);
    expect(isDisabled('2026-09-07', bounds)).toBe(false);
    expect(isDisabled('2026-12-13', bounds)).toBe(false);
    expect(isDisabled('2026-12-14', bounds)).toBe(true);
    expect(isDisabled('2030-01-01')).toBe(false);
  });
  it('expands exceptions with both ends included', () => {
    const days = expandClosedDays([
      { from: '2026-11-16', to: '2026-11-18' },
      { from: '2026-09-21', to: '2026-09-21' },
    ]);
    expect([...days].sort()).toEqual([
      '2026-09-21',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
    ]);
  });
});

describe('shortcutRange', () => {
  const bounds = { start: '2026-09-07', end: '2026-12-13' };
  it('sets today, the last 7 days and clears', () => {
    expect(shortcutRange('today', '2026-11-07')).toEqual({
      from: '2026-11-07',
      to: '2026-11-07',
    });
    expect(shortcutRange('last7', '2026-11-07')).toEqual({
      from: '2026-11-01',
      to: '2026-11-07',
    });
    expect(shortcutRange('clear', '2026-11-07')).toEqual({ from: '', to: '' });
  });
  it('uses the period only when there is one', () => {
    expect(shortcutRange('period', '2026-11-07', bounds)).toEqual({
      from: '2026-09-07',
      to: '2026-12-13',
    });
    expect(shortcutRange('period', '2026-11-07')).toBeUndefined();
  });
});

describe('pickRangeDay', () => {
  const full = { from: '2026-11-10', to: '2026-11-15' };
  const state = (active: 'from' | 'to', range = full) => ({
    ...range,
    active,
    pending: null,
  });

  it('builds an incomplete range from the first to the second click', () => {
    const first = pickRangeDay(
      state('from', { from: '', to: '' }),
      '2026-11-20',
    );
    expect(first).toMatchObject({ emit: false, close: false, active: 'to' });
    expect(first.pending).toBe('2026-11-20');
    const second = pickRangeDay(
      { from: '', to: '', active: 'to', pending: '2026-11-20' },
      '2026-11-12',
    );
    expect(second).toMatchObject({
      range: { from: '2026-11-12', to: '2026-11-20' },
      emit: true,
      close: true,
      adjusted: null,
      pending: null,
    });
  });
  it('treats a half-filled range as incomplete', () => {
    const result = pickRangeDay(
      state('to', { from: '2026-11-10', to: '' }),
      '2026-11-12',
    );
    expect(result).toMatchObject({ emit: false, pending: '2026-11-12' });
  });
  it('replaces only "from" and keeps the panel open on "to"', () => {
    expect(pickRangeDay(state('from'), '2026-11-12')).toMatchObject({
      range: { from: '2026-11-12', to: '2026-11-15' },
      active: 'to',
      emit: true,
      close: false,
      adjusted: null,
    });
  });
  it('replaces only "to" and closes', () => {
    expect(pickRangeDay(state('to'), '2026-11-16')).toMatchObject({
      range: { from: '2026-11-10', to: '2026-11-16' },
      emit: true,
      close: true,
      adjusted: null,
    });
  });
  it('sets "to" to the new "from" when it would be inverted', () => {
    expect(pickRangeDay(state('from'), '2026-11-20')).toMatchObject({
      range: { from: '2026-11-20', to: '2026-11-20' },
      adjusted: 'to',
      close: false,
    });
  });
  it('sets "from" to the new "to" when it would be inverted', () => {
    expect(pickRangeDay(state('to'), '2026-11-05')).toMatchObject({
      range: { from: '2026-11-05', to: '2026-11-05' },
      adjusted: 'from',
      close: true,
    });
  });
  it('allows a one-day range at either end', () => {
    expect(pickRangeDay(state('from'), '2026-11-15').adjusted).toBeNull();
    expect(pickRangeDay(state('to'), '2026-11-10').adjusted).toBeNull();
  });
});

describe('rangeInstruction', () => {
  const base = {
    single: false,
    complete: false,
    active: 'from',
    pending: false,
  } as const;
  it.each([
    [{}, 'Elige el día de inicio'],
    [{ pending: true }, 'Ahora elige el día final'],
    [{ complete: true }, 'Elige el nuevo día de inicio'],
    [{ complete: true, active: 'to' as const }, 'Elige el nuevo día final'],
    [{ single: true }, 'Elige la fecha'],
  ])('%j -> %s', (override, text) => {
    expect(rangeInstruction({ ...base, ...override })).toBe(text);
  });
});
