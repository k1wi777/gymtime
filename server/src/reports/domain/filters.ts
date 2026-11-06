import {
  addDays,
  fromBogota,
  toBogotaParts,
} from '../../common/time/bogota.js';

/** Widest range a report accepts (days, both ends included). */
export const MAX_RANGE_DAYS = 366;

/** Window used when there is neither a range nor an active period. */
export const DEFAULT_WINDOW_DAYS = 30;

const MS_PER_DAY = 86_400_000;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** Raw filters as they arrive from the query string. */
export interface RawFilters {
  from?: string;
  to?: string;
  scheduleId?: string;
  program?: string;
  studentId?: string;
}

/** Filters after normalization: the range is always complete and valid. */
export interface ReportFilters {
  /** Bogota date, inclusive. */
  from: string;
  /** Bogota date, inclusive. */
  to: string;
  scheduleId?: string;
  program?: string;
  studentId?: string;
}

export class ReportFilterError extends Error {
  constructor(
    readonly code: 'INVALID_RANGE' | 'RANGE_TOO_WIDE',
    message: string,
  ) {
    super(message);
  }
}

const isRealDate = (value: string): boolean =>
  DATE_SHAPE.test(value) &&
  toBogotaParts(fromBogota(value, '00:00')).date === value;

/** Days between two Bogota dates, both included. */
export function daysInRange(from: string, to: string): number {
  return (
    Math.round(
      (fromBogota(to, '00:00').getTime() -
        fromBogota(from, '00:00').getTime()) /
        MS_PER_DAY,
    ) + 1
  );
}

/**
 * Completes and validates the range: the active period when none is given
 * (the last 30 days without one), at most 366 days, `from <= to`.
 * @throws ReportFilterError
 */
export function resolveFilters(
  raw: RawFilters,
  activePeriod: { startDate: string; endDate: string } | null,
  today: string,
): ReportFilters {
  for (const value of [raw.from, raw.to]) {
    if (value !== undefined && !isRealDate(value)) {
      throw new ReportFilterError(
        'INVALID_RANGE',
        'Las fechas deben ser reales, con formato AAAA-MM-DD',
      );
    }
  }
  const fallback = defaultRange(activePeriod, today);
  const from = raw.from ?? fallback.from;
  const to = raw.to ?? fallback.to;
  if (from > to) {
    throw new ReportFilterError(
      'INVALID_RANGE',
      'La fecha inicial no puede ser posterior a la final',
    );
  }
  if (daysInRange(from, to) > MAX_RANGE_DAYS) {
    throw new ReportFilterError(
      'RANGE_TOO_WIDE',
      `El rango no puede superar ${MAX_RANGE_DAYS} días`,
    );
  }
  return {
    from,
    to,
    ...(raw.scheduleId && { scheduleId: raw.scheduleId }),
    ...(raw.program && { program: raw.program }),
    ...(raw.studentId && { studentId: raw.studentId }),
  };
}

/** The active period, clipped to the widest range; else the last 30 days. */
export function defaultRange(
  activePeriod: { startDate: string; endDate: string } | null,
  today: string,
): { from: string; to: string } {
  if (!activePeriod) {
    return { from: addDays(today, -(DEFAULT_WINDOW_DAYS - 1)), to: today };
  }
  const to = activePeriod.endDate;
  const widest = addDays(to, -(MAX_RANGE_DAYS - 1));
  return {
    from: activePeriod.startDate < widest ? widest : activePeriod.startDate,
    to,
  };
}

/** Lowercase without accents, to compare programs ("Ingeniería" = "ingenieria"). */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

export interface StudentRef {
  id: string;
  program: string | null;
}

/**
 * Ids of the students the filters leave in, or null when they do not restrict
 * students. A program matches exactly after normalizing; students without a
 * program only appear when no program is asked for.
 */
export function selectStudentIds(
  students: readonly StudentRef[],
  filters: Pick<ReportFilters, 'program' | 'studentId'>,
): Set<string> | null {
  if (!filters.program && !filters.studentId) return null;
  const wanted = filters.program ? normalizeText(filters.program) : null;
  const ids = students
    .filter(
      (s) =>
        (!filters.studentId || s.id === filters.studentId) &&
        (wanted === null ||
          (s.program !== null && normalizeText(s.program) === wanted)),
    )
    .map((s) => s.id);
  return new Set(ids);
}

/** Instants `[start, end)` that cover the Bogota dates `from..to`. */
export function rangeInstants(
  from: string,
  to: string,
): { start: Date; end: Date } {
  return {
    start: fromBogota(from, '00:00'),
    end: fromBogota(addDays(to, 1), '00:00'),
  };
}
