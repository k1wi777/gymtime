import {
  DISPLAY_DEFAULTS,
  generateDisplayName,
  toDisplayAscii,
  validateDisplayLines,
} from './display.js';

const limits = { cols: DISPLAY_DEFAULTS.cols, rows: DISPLAY_DEFAULTS.rows };

describe('toDisplayAscii', () => {
  it('removes accents and the enye and tidies blanks', () => {
    expect(toDisplayAscii('  Peña   Núñez Ángel ')).toBe('Pena Nunez Angel');
    expect(toDisplayAscii('Ñandú')).toBe('Nandu');
  });
});

describe('validateDisplayLines', () => {
  it('normalizes valid lines', () => {
    expect(validateDisplayLines(['Atención', 'mañana'], limits)).toEqual({
      ok: true,
      lines: ['Atencion', 'manana'],
    });
  });

  it('reports the line and the limit that was exceeded', () => {
    const result = validateDisplayLines(['x'.repeat(19)], limits);
    expect(result).toMatchObject({
      ok: false,
      errors: [{ line: 1, limit: 16 }],
    });
    expect(JSON.stringify(result)).toContain(
      'la línea 1 tiene 19 caracteres; máximo 16',
    );
  });

  it('rejects more lines than rows', () => {
    expect(validateDisplayLines(['a', 'b', 'c'], limits)).toMatchObject({
      ok: false,
      errors: [{ line: 0, limit: 2 }],
    });
  });

  it('rejects characters that cannot be shown', () => {
    expect(validateDisplayLines(['hola 😀'], limits)).toMatchObject({
      ok: false,
      errors: [{ line: 1, limit: null }],
    });
  });

  it('measures the line after normalizing', () => {
    expect(validateDisplayLines(['ñ'.repeat(16)], limits).ok).toBe(true);
  });
});

describe('generateDisplayName', () => {
  it('keeps the full name when it fits', () => {
    expect(generateDisplayName('Ana Perez', 16)).toBe('Ana Perez');
    expect(generateDisplayName('María Núñez', 16)).toBe('Maria Nunez');
  });

  it('shortens to the first name and the next initial', () => {
    expect(generateDisplayName('Ana María Gómez Pérez', 16)).toBe('Ana M.');
  });

  it('cuts a very long first name and never returns empty', () => {
    expect(
      generateDisplayName('Maximiliano-Alexander Ortega', 16),
    ).toHaveLength(16);
    expect(generateDisplayName('   ', 16)).toBe('Estudiante');
    expect(generateDisplayName('😀', 16)).toBe('Estudiante');
  });
});
