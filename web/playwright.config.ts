import { defineConfig } from '@playwright/test';

const API = 'http://localhost:3001';
const PANEL = 'http://localhost:3000';

/**
 * Browser flows of the panel. They run in the Chrome installed on the system
 * (no browser download, no internet) against:
 *  - the in-memory GymTime server with a simulated reader and a control
 *    server (`npm --prefix server run test:panel-server`), and
 *  - the production build of the panel (`next build` + `next start`).
 * The browser runs in a far-away zone on purpose: every time must still be
 * shown in America/Bogota.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: PANEL,
    channel: 'chrome',
    locale: 'es-CO',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command:
        'cd .. && npm run build -w shared -w simulator --silent && npm run test:panel-server -w server',
      url: 'http://127.0.0.1:3002/control/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: `NEXT_PUBLIC_API_URL=${API} npm run build && NEXT_PUBLIC_API_URL=${API} npm run start`,
      url: `${PANEL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
