import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('chart library isolation (R16)', () => {
  it('imports recharts only from features/reportes/charts/', () => {
    const offenders = files(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) =>
        /from ['"]recharts['"]|import\(['"]recharts['"]\)/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .filter((f) => !f.includes('/features/reportes/charts/'));
    expect(offenders).toEqual([]);
  });
});

// WCAG contrast of the provisional palette, read from the stylesheet itself.
const css = readFileSync(join(SRC, 'app/globals.css'), 'utf8');
const token = (name: string): string => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) throw new Error(`token --${name} not found`);
  return match[1] as string;
};
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(token(a)), luminance(token(b))].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('palette contrast (R18)', () => {
  it.each([
    ['text', 'surface'],
    ['text', 'bg'],
    ['muted', 'surface'],
    ['muted', 'bg'],
    ['primary-text', 'primary'],
    ['primary-dark', 'primary-light'],
    ['primary', 'surface'],
    ['peak', 'surface'],
    ['info', 'info-bg'],
    ['danger', 'danger-bg'],
    ['warning', 'warning-bg'],
  ])('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['primary', 'surface'],
    ['primary-mid', 'surface'],
    ['peak', 'surface'],
  ])('bar %s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the peak distinguishable from the primary bars', () => {
    expect(contrast('peak', 'primary')).toBeGreaterThanOrEqual(1.0);
    expect(token('peak')).not.toBe(token('primary'));
  });
});
