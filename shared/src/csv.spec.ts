import { CsvError, buildCsv, parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('reads headers and rows, skipping blank lines and the BOM', () => {
    const csv = parseCsv('﻿a,b\r\n1,2\r\n\r\n3,4\n');
    expect(csv).toEqual({
      delimiter: ',',
      headers: ['a', 'b'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    });
  });

  it('detects the semicolon delimiter', () => {
    const csv = parseCsv('Documento;Nombre\n1;Ana, Maria\n');
    expect(csv.delimiter).toBe(';');
    expect(csv.rows).toEqual([['1', 'Ana, Maria']]);
  });

  it('handles quotes, escaped quotes and line breaks inside a cell', () => {
    const csv = parseCsv('a,b\n"x ""y"" z","line1\nline2"\n');
    expect(csv.rows).toEqual([['x "y" z', 'line1\nline2']]);
  });

  it('keeps empty cells', () => {
    expect(parseCsv('a,b,c\n1,,3\n,,\n').rows).toEqual([
      ['1', '', '3'],
      ['', '', ''],
    ]);
  });

  it('rejects empty, oversized and unterminated input', () => {
    expect(() => parseCsv('  \n')).toThrow(CsvError);
    expect(() => parseCsv('a\n"open')).toThrow(/comilla/);
    expect(() => parseCsv(`a\n${'x\n'.repeat(5001)}`)).toThrow(/filas/);
    expect(() => parseCsv('x'.repeat(1_000_001))).toThrow(/tamaño/);
  });

  it('round-trips with buildCsv', () => {
    const rows = [
      ['a', 'b'],
      ['x,y', 'q"r'],
      ['', 'z'],
    ];
    expect(parseCsv(buildCsv(rows))).toEqual({
      delimiter: ',',
      headers: ['a', 'b'],
      rows: rows.slice(1),
    });
  });
});
