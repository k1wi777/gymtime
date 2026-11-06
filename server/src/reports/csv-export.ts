import { writeCsv, type CsvCell } from '@gymtime/shared';
import { formatBogota } from '../common/time/bogota.js';
import type { ReportTable } from './domain/table.js';

/** Excel needs the BOM to read UTF-8 (tildes, ñ); it is added on delivery. */
export const CSV_BOM = '﻿';

/** Largest number of rows a report may export or list per session. */
export const MAX_REPORT_ROWS = 20_000;

/** The table as CSV text: same columns and order as the JSON, dates in Bogota time. */
export function reportToCsv(table: ReportTable): string {
  const rows = table.rows.map((row) =>
    table.columns.map((column): CsvCell => {
      const value = row[column.key] ?? null;
      return column.type === 'datetime' && typeof value === 'string'
        ? formatBogota(new Date(value))
        : value;
    }),
  );
  return CSV_BOM + writeCsv(table.columns, rows);
}

/** `reporte-<kind>-<from>_<to>.csv` */
export const csvFilename = (kind: string, from: string, to: string): string =>
  `reporte-${kind}-${from}_${to}.csv`;
