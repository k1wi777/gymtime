/**
 * Single source of the B1–B17 acceptance scenarios (backlog_iteracion_2 §9):
 * which test demonstrates each one and where it runs. Three consumers read it
 * so they cannot drift apart: `vitest.config.scenarios.ts` (what runs),
 * `b-map.e2e-spec.ts` (guard against `docs/escenarios.md`) and
 * `scripts/run-scenarios.mjs` (final report).
 *
 * Paths are relative to `server/`. A `title` is the beginning of the `it(...)`
 * title, so the guard can find it in the file.
 */
export type BKind = 'memoria' | 'postgres' | 'despliegue';

export interface BTestRef {
  file: string;
  title: string;
}

export interface BScenario {
  id: string;
  kind: BKind;
  tests: BTestRef[];
}

export const B_SCENARIOS: readonly BScenario[] = [
  {
    id: 'B1',
    kind: 'memoria',
    tests: [
      {
        file: 'src/auth/auth.controller.spec.ts',
        title: 'logs in and sets an httpOnly Strict cookie',
      },
      { file: 'test/permissions.e2e-spec.ts', title: 'as an assistant' },
      { file: 'test/permissions.e2e-spec.ts', title: 'as an admin' },
    ],
  },
  {
    id: 'B2',
    kind: 'memoria',
    tests: [
      {
        file: 'src/schedules/periods/periods.service.spec.ts',
        title: 'generates the whole period when a recurring schedule',
      },
      {
        file: 'src/schedules/periods/periods.service.spec.ts',
        title: 'omits the days without service',
      },
      {
        file: 'src/schedules/periods/occurrence-dates.spec.ts',
        title: 'skips the days without service',
      },
    ],
  },
  {
    id: 'B3',
    kind: 'memoria',
    tests: [
      {
        file: 'src/students/import/student-import.service.spec.ts',
        title: 'reports each bad row with its line and reason',
      },
      {
        file: 'src/students/import/student-import.service.spec.ts',
        title: 'imports only the valid rows',
      },
    ],
  },
  {
    id: 'B4',
    kind: 'memoria',
    tests: [
      {
        file: 'test/scenarios/b4-student-assign.e2e-spec.ts',
        title: 'B4 — a student created by hand shows in the list',
      },
      {
        file: 'src/students/students.controller.spec.ts',
        title: 'creates, rejects duplicates and validates the body',
      },
    ],
  },
  {
    id: 'B5',
    kind: 'memoria',
    tests: [
      {
        file: 'test/scenarios/b5-live.e2e-spec.ts',
        title: 'B5 — the event stream delivers the entry and the exit',
      },
      {
        file: 'test/permissions.e2e-spec.ts',
        title: 'opens the event stream with the cookie',
      },
    ],
  },
  {
    id: 'B6',
    kind: 'memoria',
    tests: [
      {
        file: 'test/enrollment.e2e-spec.ts',
        title: 'enrolls: start, ack, progress, done',
      },
      {
        file: 'test/enrollment.e2e-spec.ts',
        title: 'refuses to enroll without a recorded consent',
      },
    ],
  },
  {
    id: 'B7',
    kind: 'memoria',
    tests: [
      {
        file: 'src/attendance/attendance.controller.spec.ts',
        title: 'registers an entry and an exit manually with the reason',
      },
      {
        file: 'test/permissions.e2e-spec.ts',
        title: 'attributes the audit to the user',
      },
    ],
  },
  {
    id: 'B8',
    kind: 'memoria',
    tests: [
      {
        file: 'test/display.e2e-spec.ts',
        title: 'shows the normalized message in the simulator',
      },
      {
        file: 'test/display.e2e-spec.ts',
        title: 'shows "Tiempo cumplido" with the alarm',
      },
      {
        file: 'src/alarm/alarm.controller.spec.ts',
        title: 'turns the alarm on and tests',
      },
    ],
  },
  {
    id: 'B9',
    kind: 'memoria',
    tests: [
      {
        file: 'src/reports/mini-semester.spec.ts',
        title: 'attendance: 3 of 4',
      },
      {
        file: 'src/reports/reports.service.spec.ts',
        title: 'halfway through the term',
      },
    ],
  },
  {
    id: 'B10',
    kind: 'memoria',
    tests: [
      {
        file: 'src/reports/mini-semester.spec.ts',
        title: 'stay, late arrivals, alarms and quality',
      },
    ],
  },
  {
    id: 'B11',
    kind: 'memoria',
    tests: [
      {
        file: 'src/reports/reports.controller.spec.ts',
        title: 'exports a CSV equal to the JSON',
      },
      {
        file: 'src/reports/csv-export.spec.ts',
        title: 'keeps exactly the columns',
      },
    ],
  },
  { id: 'B12', kind: 'despliegue', tests: [] },
  {
    id: 'B13',
    kind: 'postgres',
    tests: [{ file: 'scripts/verify-ops-db.sh', title: '' }],
  },
  {
    id: 'B14',
    kind: 'memoria',
    tests: [
      {
        file: 'test/erasure.e2e-spec.ts',
        title: 'drops the fingerprint from a connected reader',
      },
      {
        file: 'test/erasure.e2e-spec.ts',
        title: 'drops it after reconnection',
      },
    ],
  },
  {
    id: 'B15',
    kind: 'memoria',
    tests: [
      {
        file: 'test/scenarios/b15-offline.e2e-spec.ts',
        title: 'reconciles with the original hours',
      },
    ],
  },
  {
    id: 'B16',
    kind: 'memoria',
    tests: [
      {
        file: 'test/device-token.e2e-spec.ts',
        title: 'registers, connects with the own token, rotates and revokes',
      },
    ],
  },
  { id: 'B17', kind: 'despliegue', tests: [] },
];

/** Files that run under `npm run test:scenarios` besides `test/scenarios/`. */
export const memoryTestFiles = (): string[] => [
  ...new Set(
    B_SCENARIOS.filter((b) => b.kind === 'memoria').flatMap((b) =>
      b.tests.map((t) => t.file),
    ),
  ),
];
