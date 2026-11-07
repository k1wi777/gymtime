import { defineConfig } from 'vitest/config';

/**
 * Light load test (V19, `npm run test:load`): one simulated hour with 30
 * students per schedule. Own command because it drives the real simulator and
 * a WebSocket port; kept out of `rei check` and of `test:e2e`.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/load/**/*.e2e-spec.ts'],
    // The whole run must finish in under 60 s.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
