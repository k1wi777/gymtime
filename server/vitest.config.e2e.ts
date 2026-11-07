import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The scenarios (`npm run test:scenarios`) and the load test (`npm run test:load`)
    // have their own command: they wait real seconds and must not share the process or the timeout.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'test/scenarios/**',
      'test/load/**',
    ],
  },
});
