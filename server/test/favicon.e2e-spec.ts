import { randomBytes } from 'node:crypto';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: 'device-token-123456',
  ADMIN_API_KEY: 'admin-key-1234567890',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

const { buildInMemoryApp } = await import('./support/scenario-app.js');

describe('GET /favicon.ico (R25)', () => {
  it('answers 204 without a credential and without a body', async () => {
    const h = await buildInMemoryApp();
    try {
      const res = await fetch(`${h.httpUrl}/favicon.ico`);
      expect(res.status).toBe(204);
      expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
      expect(await res.text()).toBe('');
      // Everything else stays closed: a path next to it is still protected.
      expect((await fetch(`${h.httpUrl}/favicon.png`)).status).toBe(404);
    } finally {
      await h.close();
    }
  });
});
