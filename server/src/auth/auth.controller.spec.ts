import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller.js';
import type { AuthConfig } from './auth.config.js';
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  authTestProviders,
  panelHeaders,
  seedAccount,
  sessionCookieOf,
} from './testing.js';

async function build(overrides: Partial<AuthConfig> = {}) {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [AuthController],
    providers: authTestProviders({ corsOrigins: [TEST_ORIGIN], ...overrides }),
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, moduleRef, http: () => request(app.getHttpServer()) };
}

describe('AuthController (R1-R4, R7-R10)', () => {
  let app: INestApplication;
  let http: () => request.Agent;
  let moduleRef: TestingModule;

  const setup = async (overrides: Partial<AuthConfig> = {}) => {
    ({ app, http, moduleRef } = (await build(overrides)) as never);
  };
  const login = (username: string, password = TEST_PASSWORD) =>
    http().post('/auth/login').set(panelHeaders()).send({ username, password });

  afterEach(() => app.close());

  it('logs in and sets an httpOnly Strict cookie without Domain or Secure', async () => {
    await setup();
    await seedAccount(moduleRef, 'ana', { role: 'admin' });
    const res = await login('ana').expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith('gt_session='),
    )!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=28800/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toMatch(/Secure/i);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ username: 'ana', role: 'admin' });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash|token/i);
  });

  it('applies the cookie settings of the configuration', async () => {
    await setup({
      cookie: { domain: '.example.org', sameSite: 'Lax', secure: true },
    });
    await seedAccount(moduleRef, 'ana');
    const res = await login('ana').expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/Domain=\.example\.org/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it('answers the very same 401 for unknown, wrong password, inactive and locked', async () => {
    await setup({ loginRateLimit: 100, maxFailedAttempts: 2 });
    await seedAccount(moduleRef, 'ana');
    await seedAccount(moduleRef, 'off', { active: false });
    await seedAccount(moduleRef, 'locky');
    const bodies = [
      (await login('ghost').expect(401)).body,
      (await login('ana', 'wrong-password-1').expect(401)).body,
      (await login('off').expect(401)).body,
    ];
    await login('locky', 'wrong-password-1').expect(401);
    await login('locky', 'wrong-password-1').expect(401);
    bodies.push((await login('locky').expect(401)).body);
    for (const body of bodies) {
      expect(body).toEqual(bodies[0]);
    }
    expect(bodies[0]).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(JSON.stringify(bodies[0])).not.toMatch(/ghost|ana|locky|existe/);
  });

  it('rejects the login without the client header or from an unlisted origin (login CSRF)', async () => {
    await setup();
    await seedAccount(moduleRef, 'ana');
    const body = { username: 'ana', password: TEST_PASSWORD };
    const bare = await http().post('/auth/login').send(body).expect(403);
    expect(bare.body.code).toBe('CSRF_REJECTED');
    await http()
      .post('/auth/login')
      .set(panelHeaders('http://evil.example'))
      .send(body)
      .expect(403);
    await http()
      .post('/auth/login')
      .set({ 'x-gymtime-client': 'panel' })
      .send(body)
      .expect(403);
  });

  it('validates the body', async () => {
    await setup();
    await login('').expect(400);
    await http()
      .post('/auth/login')
      .set(panelHeaders())
      .send({ username: 'a' })
      .expect(400);
  });

  it('answers 429 with Retry-After beyond the per-IP limit, without checking the password', async () => {
    await setup({ loginRateLimit: 2 });
    await seedAccount(moduleRef, 'ana');
    await login('ana', 'wrong-password-1').expect(401);
    await login('ana', 'wrong-password-1').expect(401);
    const blocked = await login('ana').expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(sessionCookieOf(blocked.headers)).toBeUndefined();
  });

  it('serves /auth/me with the cookie and rejects it without', async () => {
    await setup();
    const ana = await seedAccount(moduleRef, 'ana', { role: 'admin' });
    const cookie = sessionCookieOf((await login('ana')).headers)!;
    const me = await http().get('/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({
      id: ana.id,
      username: 'ana',
      role: 'admin',
      mustChangePassword: false,
    });
    await http().get('/auth/me').expect(401);
    await http().get('/auth/me').set('Cookie', 'gt_session=forged').expect(401);
  });

  it('rejects the system credential on account endpoints', async () => {
    await setup();
    const res = await http()
      .get('/auth/me')
      .set('x-api-key', 'admin-key-1234567890')
      .expect(403);
    expect(res.body.code).toBe('ACCOUNT_REQUIRED');
  });

  it('logs out: revokes the session and clears the cookie', async () => {
    await setup();
    await seedAccount(moduleRef, 'ana');
    const cookie = sessionCookieOf((await login('ana')).headers)!;
    const out = await http()
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set(panelHeaders())
      .expect(204);
    expect((out.headers['set-cookie'] as unknown as string[])[0]).toMatch(
      /gt_session=;.*Expires=Thu, 01 Jan 1970/,
    );
    await http().get('/auth/me').set('Cookie', cookie).expect(401);
  });

  it('changes the password: clears the forced change and revokes other sessions', async () => {
    await setup();
    await seedAccount(moduleRef, 'ana', { mustChangePassword: true });
    const first = sessionCookieOf((await login('ana')).headers)!;
    const second = sessionCookieOf((await login('ana')).headers)!;
    const me = await http().get('/auth/me').set('Cookie', first).expect(200);
    expect(me.body.mustChangePassword).toBe(true);

    const changed = await http()
      .post('/auth/password')
      .set('Cookie', second)
      .set(panelHeaders())
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-pass' })
      .expect(200);
    expect(changed.body.mustChangePassword).toBe(false);
    await http().get('/auth/me').set('Cookie', first).expect(401);
    await http().get('/auth/me').set('Cookie', second).expect(200);
    await login('ana').expect(401);
    await login('ana', 'a-brand-new-pass').expect(200);
  });

  it('rejects weak, equal and wrongly authorized password changes', async () => {
    await setup();
    await seedAccount(moduleRef, 'ana');
    const cookie = sessionCookieOf((await login('ana')).headers)!;
    const change = (currentPassword: string, newPassword: string) =>
      http()
        .post('/auth/password')
        .set('Cookie', cookie)
        .set(panelHeaders())
        .send({ currentPassword, newPassword });
    expect((await change(TEST_PASSWORD, 'short').expect(400)).body.code).toBe(
      'PASSWORD_POLICY',
    );
    expect(
      (await change(TEST_PASSWORD, TEST_PASSWORD).expect(400)).body.code,
    ).toBe('PASSWORD_POLICY');
    expect(
      (await change('not-the-password', 'a-brand-new-pass').expect(400)).body
        .code,
    ).toBe('INVALID_CURRENT_PASSWORD');
    await http()
      .post('/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-pass' })
      .expect(403);
  });

  it('audits the account actions without secrets (R22, R23)', async () => {
    await setup();
    await seedAccount(moduleRef, 'ana');
    await login('nobody').expect(401);
    const cookie = sessionCookieOf((await login('ana')).headers)!;
    await http()
      .post('/auth/password')
      .set('Cookie', cookie)
      .set(panelHeaders())
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-pass' })
      .expect(200);
    await http()
      .post('/auth/logout')
      .set('Cookie', cookie)
      .set(panelHeaders())
      .expect(204);
    const { InMemoryEventLogRepository } =
      await import('../common/audit/in-memory-event-log.repository.js');
    const { EVENT_LOG_REPOSITORY } =
      await import('../common/audit/event-log.repository.js');
    const log =
      moduleRef.get<InstanceType<typeof InMemoryEventLogRepository>>(
        EVENT_LOG_REPOSITORY,
      );
    expect(log.entries.map((e) => e.type)).toEqual([
      'auth.login_failed',
      'auth.login_ok',
      'auth.password_changed',
      'auth.logout',
    ]);
    const text = JSON.stringify(log.entries) + cookie;
    expect(text).not.toContain('a-brand-new-pass');
    expect(JSON.stringify(log.entries)).not.toContain(cookie.split('=')[1]);
  });
});
