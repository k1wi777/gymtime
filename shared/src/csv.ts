/** Largest accepted CSV text and number of data rows (E20-2). */
export const CSV_MAX_BYTES = 1_000_000;
export const CSV_MAX_ROWS = 5_000;

export interface ParsedCsv {
  delimiter: ',' | ';';
  headers: string[];
  /** Data rows; blank lines are skipped. */
  rows: string[][];
}

export type CsvErrorCode =
  'EMPTY' | 'TOO_LARGE' | 'TOO_MANY_ROWS' | 'UNCLOSED_QUOTE';

export class CsvError extends Error {
  constructor(
    readonly code: CsvErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** `;` wins when the header line has more semicolons than commas (Excel in Spanish). */
function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (char: string) => firstLine.split(char).length - 1;
  return count(';') > count(',') ? ';' : ',';
}

/**
 * RFC 4180 reader: quoted cells with `""` escapes and line breaks, `,` or `;`
 * delimiter detected from the header, optional BOM, CRLF or LF.
 * @throws CsvError when the text is empty, too large, has too many rows or
 * ends inside a quote.
 */
export function parseCsv(input: string): ParsedCsv {
  if (new TextEncoder().encode(input).length > CSV_MAX_BYTES) {
    throw new CsvError('TOO_LARGE', 'El archivo supera el tamaño permitido');
  }
  const text = input.replace(/^﻿/, '');
  if (text.trim() === '') throw new CsvError('EMPTY', 'El archivo está vacío');
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let touched = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (touched || row.some((c) => c !== '')) records.push(row);
    row = [];
    touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
      touched = true;
    } else if (char === delimiter) {
      endCell();
      touched = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow();
      if (records.length > CSV_MAX_ROWS + 1) tooManyRows();
    } else cell += char;
  }
  if (quoted) {
    throw new CsvError('UNCLOSED_QUOTE', 'Hay una comilla sin cerrar');
  }
  if (cell !== '' || row.length > 0) endRow();
  const [headers = [], ...rows] = records;
  if (rows.length > CSV_MAX_ROWS) tooManyRows();
  return { delimiter, headers: headers.map((h) => h.trim()), rows };
}

function tooManyRows(): never {
  throw new CsvError(
    'TOO_MANY_ROWS',
    `El archivo supera ${CSV_MAX_ROWS} filas`,
  );
}

const needsQuotes = /[",;\r\n]/;

/** Serializes rows with `,` and CRLF, quoting only where needed. */
export function buildCsv(rows: readonly (readonly string[])[]): string {
  return (
    rows
      .map((row) =>
        row
          .map((cell) =>
            needsQuotes.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
          )
          .join(','),
      )
      .join('\r\n') + '\r\n'
  );
}

export type CsvColumnType =
  'text' | 'int' | 'decimal' | 'percent' | 'datetime' | 'date';

export interface CsvColumn {
  label: string;
  type: CsvColumnType;
}

/** Number cells are numbers; text, date and datetime cells arrive formatted. */
export type CsvCell = string | number | null;

/** Cells that Excel would evaluate as a formula when they open a text cell. */
const FORMULA_START = /^\s*[=+\-@\t\r]/;

/**
 * Text typed by people (names, programs, reasons) must not start a formula
 * (OWASP "CSV injection"): a `'` in front makes Excel show it as text. Numbers
 * are written by the server and are never neutralized.
 */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function formatCell(type: CsvColumnType, value: CsvCell): string {
  if (value === null || value === '') return '';
  switch (type) {
    case 'text':
      return neutralizeFormula(String(value));
    case 'int':
      return String(value);
    case 'decimal':
    case 'percent':
      return typeof value === 'number'
        ? value.toFixed(1).replace('.', ',')
        : String(value);
    default:
      return String(value);
  }
}

/**
 * Report CSV for Excel in Spanish: `;` separator, CRLF, decimal comma,
 * RFC 4180 quoting, formulas neutralized in text columns. The UTF-8 BOM is
 * added where the file is delivered, not here.
 */
export function writeCsv(
  columns: readonly CsvColumn[],
  rows: readonly (readonly CsvCell[])[],
): string {
  const quote = (cell: string) =>
    /[";\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  const lines = [
    columns.map((c) => quote(neutralizeFormula(c.label))).join(';'),
    ...rows.map((row) =>
      columns
        .map((c, i) => quote(formatCell(c.type, row[i] ?? null)))
        .join(';'),
    ),
  ];
  return lines.join('\r\n') + '\r\n';
}
