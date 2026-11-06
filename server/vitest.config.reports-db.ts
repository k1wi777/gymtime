import { defineConfig } from 'vitest/config';

// V15: the report reads and timings against a real PostgreSQL (see
// scripts/verify-reports-db.sh). Never part of `npm test`.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.db-spec.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
