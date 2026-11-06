/** Defaults of the 16x2 LCD; the server reads them from the environment. */
export const DISPLAY_DEFAULTS = {
  cols: 16,
  rows: 2,
  resultSeconds: 3,
} as const;

export interface DisplayLimits {
  cols: number;
  rows: number;
}

export interface DisplayLineError {
  /** 1-based line number, or 0 when the problem is the number of lines. */
  line: number;
  /** The limit that was exceeded (columns or rows), when it applies. */
  limit: number | null;
  message: string;
}

export type DisplayValidation =
  { ok: true; lines: string[] } | { ok: false; errors: DisplayLineError[] };

const COMBINING_MARKS = /[̀-ͯ]/g;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * The LCD only draws ASCII: removes accents (`á→a`, `ñ→n`), collapses blanks
 * and trims the text. Characters without an ASCII form are kept so that the
 * validation can report them.
 */
export function toDisplayAscii(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalizes and checks the lines against the display size. */
export function validateDisplayLines(
  lines: readonly string[],
  limits: DisplayLimits,
): DisplayValidation {
  const normalized = lines.map(toDisplayAscii);
  const errors: DisplayLineError[] = [];
  if (normalized.length > limits.rows) {
    errors.push({
      line: 0,
      limit: limits.rows,
      message: `hay ${normalized.length} líneas; máximo ${limits.rows}`,
    });
  }
  normalized.forEach((line, index) => {
    if (line.length > limits.cols) {
      errors.push({
        line: index + 1,
        limit: limits.cols,
        message: `la línea ${index + 1} tiene ${line.length} caracteres; máximo ${limits.cols}`,
      });
    }
    if (!PRINTABLE_ASCII.test(line)) {
      errors.push({
        line: index + 1,
        limit: null,
        message: `la línea ${index + 1} contiene caracteres que la pantalla no puede mostrar (solo ASCII imprimible)`,
      });
    }
  });
  return errors.length === 0
    ? { ok: true, lines: normalized }
    : { ok: false, errors };
}

const FALLBACK_NAME = 'Estudiante';

/**
 * Short name for the LCD: the full name when it fits; otherwise the first name
 * plus the initial of the next one (`Ana M.`); as a last resort the first name
 * cut to `cols`. Never empty and always ASCII.
 */
export function generateDisplayName(fullName: string, cols: number): string {
  const name = toDisplayAscii(fullName).replace(/[^\x20-\x7e]/g, '');
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean === '') return FALLBACK_NAME.slice(0, cols);
  if (clean.length <= cols) return clean;
  const [first, second] = clean.split(' ');
  const short = second ? `${first} ${second[0].toUpperCase()}.` : first;
  return short.length <= cols ? short : first.slice(0, cols);
}
