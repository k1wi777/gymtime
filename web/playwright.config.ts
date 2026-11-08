import { defineConfig } from '@playwright/test';

// Ports can be moved (e.g. when a dev server uses 3000/3001) with
// E2E_PANEL_PORT, E2E_API_PORT and E2E_CONTROL_PORT.
const PANEL_PORT = process.env.E2E_PANEL_PORT ?? '3000';
const API_PORT = process.env.E2E_API_PORT ?? '3001';
const CONTROL_PORT = process.env.E2E_CONTROL_PORT ?? '3002';
const API = `http://localhost:${API_PORT}`;
const PANEL = `http://localhost:${PANEL_PORT}`;

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
      command: `cd .. && npm run build -w shared -w simulator --silent && PANEL_API_PORT=${API_PORT} PANEL_ORIGIN=${PANEL} PANEL_CONTROL_PORT=${CONTROL_PORT} npm run test:panel-server -w server`,
      url: `http://127.0.0.1:${CONTROL_PORT}/control/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: `NEXT_PUBLIC_API_URL=${API} npm run build && NEXT_PUBLIC_API_URL=${API} npm run start -- -p ${PANEL_PORT}`,
      url: `${PANEL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
