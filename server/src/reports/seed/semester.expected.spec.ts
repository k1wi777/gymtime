import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { keyFigures } from './expected.js';
import { SEMESTER_NOW, buildSemester } from './semester.js';

const FILE = fileURLToPath(
  new URL('./semester.expected.json', import.meta.url),
);

describe('semester.expected.json (regression guard of the generator)', () => {
  it('matches the key figures of the seeded semester', () => {
    const figures = keyFigures(buildSemester(), SEMESTER_NOW);
    // Regenerate on purpose with: UPDATE_EXPECTED=1 npx vitest run src/reports/seed
    if (process.env.UPDATE_EXPECTED === '1') {
      writeFileSync(FILE, JSON.stringify(figures, null, 2) + '\n');
    }
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(figures)),
    );
  });
});
