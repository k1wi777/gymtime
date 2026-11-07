import { defineConfig } from 'vitest/config';

// V16: key rotation, leader lock, backup and restore against a real PostgreSQL
// (see scripts/verify-ops-db.sh). Never part of `npm test`.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.ops-spec.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
