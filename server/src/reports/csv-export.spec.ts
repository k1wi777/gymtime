import { parseCsv } from '@gymtime/shared';
import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvFilename, reportToCsv } from './csv-export.js';
import type { ReportTable } from './domain/table.js';

const table: ReportTable = {
  columns: [
    { key: 'name', label: 'Estudiante', type: 'text' },
    { key: 'n', label: 'Cantidad', type: 'int' },
    { key: 'avg', label: 'Promedio (min)', type: 'decimal' },
    { key: 'at', label: 'Entrada', type: 'datetime' },
  ],
  rows: [
    {
      id: 'x',
      name: 'Ñandú; "Pérez"',
      n: 2,
      avg: 12.5,
      at: '2026-03-02T11:00:59.000Z',
    },
    { id: 'y', name: "=cmd|' /C calc'!A0", n: -1, avg: null, at: null },
    { name: '@SUM(A1)', n: 0, avg: 0, at: null },
  ],
  meta: {},
};

describe('reportToCsv', () => {
  const csv = reportToCsv(table);

  it('starts with the BOM, uses ; and CRLF and writes dates in Bogota time', () => {
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain('Estudiante;Cantidad;Promedio (min);Entrada\r\n');
    expect(csv).toContain(';2026-03-02 06:00:59\r\n');
    expect(csv).toContain(';12,5;');
  });

  it('keeps exactly the columns (the row id is not exported) and neutralizes formulas', () => {
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual([
      'Estudiante',
      'Cantidad',
      'Promedio (min)',
      'Entrada',
    ]);
    expect(parsed.rows.map((r) => r[0])).toEqual([
      'Ñandú; "Pérez"',
      "'=cmd|' /C calc'!A0",
      "'@SUM(A1)",
    ]);
    expect(parsed.rows[1]![1]).toBe('-1');
    expect(parsed.rows[0]).toHaveLength(4);
  });

  it('names the file after the report and the range', () => {
    expect(csvFilename('flow', '2026-02-02', '2026-05-29')).toBe(
      'reporte-flow-2026-02-02_2026-05-29.csv',
    );
  });
});
