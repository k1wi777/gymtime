export const COLUMN_TYPES = [
  'text',
  'int',
  'decimal',
  'percent',
  'datetime',
  'date',
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

/**
 * Cell values by column type: `text`/`date` strings, `int`/`decimal`/`percent`
 * numbers (a percent is already 0-100), `datetime` an ISO instant; null when
 * there is no value.
 */
export type CellValue = string | number | null;

/** Keyed by column key; an extra `id` (not a column) is the row's student, for the detail view. */
export type ReportRow = Record<string, CellValue>;

export interface ReportTable {
  columns: ReportColumn[];
  rows: ReportRow[];
  meta: Record<string, unknown>;
}

export type SortDir = 'asc' | 'desc';

const collator = new Intl.Collator('es', {
  sensitivity: 'base',
  numeric: true,
});

function compareCells(type: ColumnType, a: CellValue, b: CellValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (type === 'datetime' || type === 'date') {
    return String(a).localeCompare(String(b));
  }
  return collator.compare(String(a), String(b));
}

/**
 * Stable sort by one column; empty cells always go last, whatever the
 * direction. An unknown key leaves the order untouched.
 */
export function sortRows(
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
  key: string | undefined,
  dir: SortDir = 'asc',
): ReportRow[] {
  const column = columns.find((c) => c.key === key);
  if (!column) return [...rows];
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const a = x.row[column.key] ?? null;
      const b = y.row[column.key] ?? null;
      if (a === null || b === null) {
        return a === b ? x.index - y.index : a === null ? 1 : -1;
      }
      return sign * compareCells(column.type, a, b) || x.index - y.index;
    })
    .map((x) => x.row);
}

/** Half-up rounding to `digits` decimals (values here are never negative). */
export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Percentage 0-100 with one decimal; null when the denominator is zero. */
export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : round((part / whole) * 100, 1);
}

/** Average of `sum / count` with the given decimals; null without items. */
export function average(sum: number, count: number, digits = 1): number | null {
  return count === 0 ? null : round(sum / count, digits);
}
