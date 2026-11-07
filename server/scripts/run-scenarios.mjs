#!/usr/bin/env node
// `npm run test:scenarios [-- --db]`: A1–A12 and the in-memory B scenarios in
// one command. Prints a table per scenario and what only a deployment can
// show. `--db` also runs B13 (`test:ops-db`, needs PostgreSQL).
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const server = resolve(import.meta.dirname, '..');
const withDb = process.argv.includes('--db');
const reportFile = resolve(tmpdir(), `gymtime-scenarios-${process.pid}.json`);

const run = (command, args) =>
  spawnSync(command, args, { cwd: server, stdio: 'inherit' });

const vitest = run('npx', [
  'vitest',
  'run',
  '--config',
  './vitest.config.scenarios.ts',
  '--reporter=default',
  '--reporter=json',
  `--outputFile.json=${reportFile}`,
]);
let status = vitest.status ?? 1;

// Node strips the types of the map (it has no enums), so the same file feeds
// the vitest config, the guard and this report.
const { B_SCENARIOS } = await import('../test/scenarios/b-map.ts');

let results = [];
try {
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  results = report.testResults.flatMap((file) =>
    file.assertionResults.map((t) => ({
      file: file.name,
      title: t.fullName,
      status: t.status,
    })),
  );
} catch {
  console.error('No test report was produced.');
  status ||= 1;
} finally {
  rmSync(reportFile, { force: true });
}

console.log('\nScenario results');
console.log('----------------');
const pad = (text, n) => String(text).padEnd(n);
const pending = [];
for (const b of B_SCENARIOS) {
  if (b.kind === 'despliegue') {
    pending.push(b.id);
    console.log(`${pad(b.id, 4)} ${pad('despliegue', 12)} pending`);
    continue;
  }
  if (b.kind === 'postgres') {
    if (!withDb) {
      console.log(`${pad(b.id, 4)} ${pad('postgres', 12)} not run (use --db)`);
      continue;
    }
    console.log(`${pad(b.id, 4)} ${pad('postgres', 12)} see test:ops-db below`);
    continue;
  }
  const mine = results.filter((r) =>
    b.tests.some(
      (t) => r.file.endsWith(`/${t.file}`) && r.title.includes(t.title),
    ),
  );
  const failed = mine.filter((r) => r.status !== 'passed');
  const label =
    mine.length === 0
      ? 'MISSING'
      : failed.length > 0
        ? `FAILED (${failed.length})`
        : `ok (${mine.length} tests)`;
  if (mine.length === 0 || failed.length > 0) status ||= 1;
  console.log(`${pad(b.id, 4)} ${pad('memoria', 12)} ${label}`);
}

if (withDb) {
  console.log('\nB13: npm run test:ops-db');
  status ||= run('npm', ['run', 'test:ops-db']).status ?? 1;
}

console.log(
  `\nPending in the test deployment (not simulated): ${pending.join(', ')}. ` +
    'See docs/escenarios.md for the manual procedure.',
);
if (!withDb) {
  console.log('B13 was not run: add --db (needs PostgreSQL) to run it.');
}
process.exit(status);
