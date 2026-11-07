import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { B_SCENARIOS, type BKind } from './b-map.js';

const SERVER = resolve(import.meta.dirname, '../..');
const DOC = resolve(SERVER, '../docs/escenarios.md');

interface DocRow {
  kind: string;
  files: string[];
}

/** Rows `| B<n> | ... |` of docs/escenarios.md: environment and test files. */
function docRows(): Map<string, DocRow> {
  const rows = new Map<string, DocRow>();
  for (const line of readFileSync(DOC, 'utf8').split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (!/^B\d+$/.test(cells[1] ?? '')) continue;
    // | id | scenario | tests | command | environment | expected |
    rows.set(cells[1], {
      kind: cells[5],
      files: [...cells[3].matchAll(/`([^`]+)`/g)].map((m) => m[1]),
    });
  }
  return rows;
}

const KIND_LABEL: Record<BKind, string> = {
  memoria: 'memoria',
  postgres: 'PostgreSQL',
  despliegue: 'despliegue de prueba',
};

describe('B1–B17 map (guard)', () => {
  it('declares B1 to B17, once each', () => {
    expect(B_SCENARIOS.map((b) => b.id)).toEqual(
      Array.from({ length: 17 }, (_, i) => `B${i + 1}`),
    );
  });

  it.each(B_SCENARIOS.filter((b) => b.tests.length > 0))(
    '$id points to files and titles that exist',
    (scenario) => {
      for (const test of scenario.tests) {
        const path = resolve(SERVER, test.file);
        expect(existsSync(path), `${scenario.id}: ${test.file}`).toBe(true);
        if (test.title === '') continue;
        const source = readFileSync(path, 'utf8');
        expect(
          source.includes(`it('${test.title}`),
          `${scenario.id}: no it('${test.title}…') in ${test.file}`,
        ).toBe(true);
      }
    },
  );

  it('only the in-memory scenarios have tests that run here; the deployment ones have none', () => {
    for (const b of B_SCENARIOS) {
      if (b.kind === 'despliegue') expect(b.tests, b.id).toHaveLength(0);
      else expect(b.tests.length, b.id).toBeGreaterThan(0);
    }
  });

  it('docs/escenarios.md has the same table as the map', () => {
    const rows = docRows();
    expect([...rows.keys()]).toEqual(B_SCENARIOS.map((b) => b.id));
    for (const b of B_SCENARIOS) {
      const row = rows.get(b.id)!;
      expect(row.kind, `${b.id}: environment`).toBe(KIND_LABEL[b.kind]);
      expect([...new Set(row.files)].sort(), `${b.id}: test files`).toEqual(
        [...new Set(b.tests.map((t) => `server/${t.file}`))].sort(),
      );
    }
  });
});
