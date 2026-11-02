import { defineConfig } from 'vitest/config';

/**
 * Scenarios A1–A12: one command, no PostgreSQL and no hardware. Kept out of
 * `vitest.config.ts` (unit) and of `rei check` because they drive the real
 * simulator and wait real time for the short beep.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/scenarios/**/*.e2e-spec.ts'],
    // A11 waits the 5 s of the short beep; the rest moves a fake clock.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // One file at a time: a failure is never confused with port contention.
    fileParallelism: false,
  },
});
