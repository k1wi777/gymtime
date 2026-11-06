import { CsvError, buildCsv, parseCsv, writeCsv } from './csv.js';

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

describe('writeCsv (report export)', () => {
  const columns = [
    { label: 'Nombre', type: 'text' as const },
    { label: 'Cantidad', type: 'int' as const },
    { label: 'Promedio', type: 'decimal' as const },
    { label: 'Porcentaje', type: 'percent' as const },
    { label: 'Fecha', type: 'date' as const },
  ];

  it('uses ; CRLF, decimal comma and an empty cell for null', () => {
    const text = writeCsv(columns, [
      ['Ana', 3, 12.34, 83.3, '2026-02-02'],
      ['Luis', 0, null, null, null],
    ]);
    expect(text).toBe(
      'Nombre;Cantidad;Promedio;Porcentaje;Fecha\r\n' +
        'Ana;3;12,3;83,3;2026-02-02\r\n' +
        'Luis;0;;;\r\n',
    );
  });

  it.each([
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tTAB', "'\tTAB"],
    ['  =1+1', "'  =1+1"],
  ])('neutralizes the formula text %j', (value, expected) => {
    const row = writeCsv([{ label: 'T', type: 'text' }], [[value]]).split(
      '\r\n',
    )[1] as string;
    expect(row.replace(/^"|"$/g, '')).toBe(expected);
  });

  it('does not touch numbers, even negative ones, or dates', () => {
    const text = writeCsv(
      [
        { label: 'N', type: 'int' },
        { label: 'D', type: 'decimal' },
      ],
      [[-5, -1.25]],
    );
    expect(text).toBe('N;D\r\n-5;-1,3\r\n');
  });

  it('quotes cells with ; quotes and line breaks and round-trips with parseCsv', () => {
    const rows = [
      ['a;b', 1, 1, 1, ''],
      ['dice "hola"', 2, 1, 1, ''],
      ['línea\nnueva ñandú', 3, 1, 1, ''],
    ] as const;
    const parsed = parseCsv('﻿' + writeCsv(columns, rows));
    expect(parsed.delimiter).toBe(';');
    expect(parsed.headers).toEqual(columns.map((c) => c.label));
    expect(parsed.rows.map((r) => r[0])).toEqual([
      'a;b',
      'dice "hola"',
      'línea\nnueva ñandú',
    ]);
  });
});
