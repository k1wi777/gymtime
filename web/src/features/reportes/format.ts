import { formatDay, formatDateTime } from '@/lib/time';

/** Every number shown in a report uses the Colombian format (`1.234,5`). */
const INT = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const formatInt = (value: number): string => INT.format(value);
export const formatDecimal = (value: number): string =>
  ONE_DECIMAL.format(value);
export const formatPercent = (value: number): string =>
  `${ONE_DECIMAL.format(value)} %`;

export type CellType =
  'text' | 'int' | 'decimal' | 'percent' | 'datetime' | 'date';

/** Text of a table cell by column type; an empty value is an em dash. */
export function formatCell(type: CellType, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'int':
      return formatInt(Number(value));
    case 'decimal':
      return formatDecimal(Number(value));
    case 'percent':
      return formatPercent(Number(value));
    case 'datetime':
      return formatDateTime(String(value));
    case 'date':
      return formatDay(String(value));
    default:
      return String(value);
  }
}
