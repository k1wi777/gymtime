import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The A1–A12 scenarios have their own command (`npm run test:scenarios`):
    // they wait real seconds and must not share the process or the timeout.
    exclude: ['**/node_modules/**', '**/dist/**', 'test/scenarios/**'],
  },
});
