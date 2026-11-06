import { defineConfig } from 'vitest/config';

/**
 * Harness of the panel's browser flows (`npm run test:panel-server`): it is not
 * a test that finishes but the in-memory server Playwright drives. Kept out of
 * `vitest.config.ts` (unit) and `vitest.config.e2e.ts` on purpose.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/panel/**/*.panel-spec.ts'],
    // Runs until Playwright stops it.
    testTimeout: 2_147_483_647,
    hookTimeout: 60_000,
  },
});
