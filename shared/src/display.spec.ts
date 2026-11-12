import {
  DISPLAY_DEFAULTS,
  DISPLAY_TONES,
  LEGACY_TONE_COLORS,
  buildDisplayPayload,
  generateDisplayName,
  normalizeDisplayText,
  toAscii,
  validateDisplayMessage,
} from './display.js';

const limits = {
  titleMax: DISPLAY_DEFAULTS.titleMax,
  subtitleMax: DISPLAY_DEFAULTS.subtitleMax,
  subtitleLines: DISPLAY_DEFAULTS.subtitleLines,
};

describe('normalizeDisplayText', () => {
  it('keeps accents and the enye and tidies blanks', () => {
    expect(normalizeDisplayText('  Peña   Núñez Ángel ')).toBe(
      'Peña Núñez Ángel',
    );
  });

  it('keeps line breaks, trimming each line', () => {
    expect(normalizeDisplayText(' a  b \r\n  c ')).toBe('a b\nc');
  });
});

describe('validateDisplayMessage', () => {
  it('normalizes a valid message and defaults the tone to info', () => {
    expect(
      validateDisplayMessage({ title: ' Atención ', subtitle: 'mañana' }),
    ).toEqual({
      ok: true,
      message: { title: 'Atención', subtitle: 'mañana', tone: 'info' },
    });
  });

  it('accepts a two-line subtitle', () => {
    expect(
      validateDisplayMessage({ title: 'a', subtitle: 'uno\ndos' }, limits).ok,
    ).toBe(true);
  });

  it('reports the field and the limit of a long title', () => {
    const result = validateDisplayMessage({ title: 'x'.repeat(33) }, limits);
    expect(result).toMatchObject({
      ok: false,
      errors: [{ field: 'title', limit: 32 }],
    });
    expect(JSON.stringify(result)).toContain('máximo 32');
  });

  it('rejects a long subtitle and more than two lines', () => {
    expect(
      validateDisplayMessage({ title: 'a', subtitle: 'x'.repeat(81) }),
    ).toMatchObject({ ok: false, errors: [{ field: 'subtitle', limit: 80 }] });
    expect(
      validateDisplayMessage({ title: 'a', subtitle: 'a\nb\nc' }),
    ).toMatchObject({ ok: false, errors: [{ field: 'subtitle', limit: 2 }] });
  });

  it('rejects a title with a line break', () => {
    expect(validateDisplayMessage({ title: 'a\nb' })).toMatchObject({
      ok: false,
      errors: [{ field: 'title' }],
    });
  });

  it('rejects only non printable characters', () => {
    expect(validateDisplayMessage({ title: 'a\u0007b' })).toMatchObject({
      ok: false,
      errors: [{ field: 'title', limit: null }],
    });
    expect(
      validateDisplayMessage({ title: '¡Hola! ñandú €', subtitle: '😀' }).ok,
    ).toBe(true);
  });
});

describe('buildDisplayPayload', () => {
  it('derives the deprecated aliases from the contract fields', () => {
    for (const tone of DISPLAY_TONES) {
      expect(buildDisplayPayload({ title: 'T', subtitle: 'S', tone })).toEqual({
        title: 'T',
        subtitle: 'S',
        tone,
        line1: 'T',
        line2: 'S',
        color: LEGACY_TONE_COLORS[tone],
      });
    }
  });
});

describe('toAscii', () => {
  it('removes accents and the enye', () => {
    expect(toAscii('  Peña   Núñez Ángel ')).toBe('Pena Nunez Angel');
  });
});

describe('generateDisplayName', () => {
  it('keeps the full name, with accents, when it fits', () => {
    expect(generateDisplayName('Ana Perez', 24)).toBe('Ana Perez');
    expect(generateDisplayName('María Núñez', 24)).toBe('María Núñez');
  });

  it('shortens to the first name and the next initial', () => {
    expect(generateDisplayName('Ana María Gómez Pérez Rodríguez', 24)).toBe(
      'Ana M.',
    );
  });

  it('cuts a very long first name and never returns empty', () => {
    expect(
      generateDisplayName('Maximiliano-Alexander-Ortega-Gutierrez', 24),
    ).toHaveLength(24);
    expect(generateDisplayName('   ', 24)).toBe('Estudiante');
  });
});
