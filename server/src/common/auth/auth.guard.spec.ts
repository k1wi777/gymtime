import { Controller, Get, Post, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { currentActor, runAsActor, SYSTEM_ACTOR } from '../audit/actor.js';
import { USERS_REPOSITORY } from '../../auth/domain/users.repository.js';
import { SESSIONS_REPOSITORY } from '../../auth/domain/sessions.repository.js';
import type { InMemoryUsersRepository } from '../../auth/infrastructure/in-memory-users.repository.js';
import type { InMemorySessionsRepository } from '../../auth/infrastructure/in-memory-sessions.repository.js';
import { AuthController } from '../../auth/auth.controller.js';
import { defaultAuthConfig } from '../../auth/auth.config.js';
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  authTestProviders,
  panelHeaders,
  seedAccount,
  sessionCookieOf,
} from '../../auth/testing.js';
import { Auth, type AuthContext } from './auth-context.js';
import { Public, Roles } from './roles.decorator.js';

const KEY = { 'x-api-key': defaultAuthConfig.adminApiKey };

@Controller('probe')
class ProbeController {
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Public()
  @Post('open')
  openWrite() {
    return { ok: true };
  }

  // No decorator: a session of any role, by default.
  @Get('any')
  any(@Auth() auth: AuthContext | undefined) {
    return { kind: auth?.kind, role: auth?.role, actor: currentActor() };
  }

  @Post('any')
  anyWrite() {
    return { ok: true };
  }

  @Roles('admin')
  @Get('admin')
  admin() {
    return { ok: true };
  }
}

describe('AuthGuard (R6, R15, R16, R18)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [ProbeController, AuthController],
      providers: authTestProviders({ corsOrigins: [TEST_ORIGIN] }),
    }).compile();
    app = moduleRef.createNestApplication();
    // What ActorMiddleware does in the real application.
    app.use((_req: unknown, _res: unknown, next: () => void) =>
      runAsActor(SYSTEM_ACTOR, next),
    );
    await app.init();
  });

  afterEach(() => app.close());

  const cookieFor = async (
    username: string,
    options: Parameters<typeof seedAccount>[2] = {},
  ) => {
    await seedAccount(moduleRef, username, options);
    const res = await http()
      .post('/auth/login')
      .set(panelHeaders())
      .send({ username, password: TEST_PASSWORD })
      .expect(200);
    return sessionCookieOf(res.headers)!;
  };

  it('denies by default: no credential, 401', async () => {
    await http().get('/probe/any').expect(401);
    await http().get('/probe/admin').expect(401);
    await http().post('/probe/any').set(panelHeaders()).expect(401);
  });

  it('lets public endpoints through without credential', async () => {
    await http().get('/probe/open').expect(200);
  });

  it('ignores a wrong key on a public endpoint', async () => {
    await http().get('/probe/open').set('x-api-key', 'nope').expect(200);
  });

  it('accepts the system key as admin with the system actor and no CSRF', async () => {
    const read = await http().get('/probe/any').set(KEY).expect(200);
    expect(read.body).toEqual({
      kind: 'system',
      role: 'admin',
      actor: { type: 'system', id: null },
    });
    await http().post('/probe/any').set(KEY).expect(201);
    await http().get('/probe/admin').set(KEY).expect(200);
  });

  it('rejects a wrong key even when a valid cookie comes along', async () => {
    const cookie = await cookieFor('ana');
    await http()
      .get('/probe/any')
      .set('x-api-key', 'wrong-key-123456789')
      .set('Cookie', cookie)
      .expect(401);
    await http().get('/probe/any').set('x-api-key', '').expect(401);
  });

  it('accepts a session of any role on undecorated endpoints and attributes the actor', async () => {
    const cookie = await cookieFor('ana', { role: 'asistente' });
    const res = await http()
      .get('/probe/any')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toMatchObject({ kind: 'session', role: 'asistente' });
    expect(res.body.actor).toMatchObject({ type: 'user' });
    expect(res.body.actor.id).toEqual(expect.any(String));
  });

  it('answers 403 FORBIDDEN_ROLE for an assistant on @Roles("admin")', async () => {
    const assistant = await cookieFor('ana', { role: 'asistente' });
    const admin = await cookieFor('boss', { role: 'admin' });
    const denied = await http()
      .get('/probe/admin')
      .set('Cookie', assistant)
      .expect(403);
    expect(denied.body.code).toBe('FORBIDDEN_ROLE');
    await http().get('/probe/admin').set('Cookie', admin).expect(200);
  });

  it('blocks everything but the password routes while the password is temporary (R6)', async () => {
    const cookie = await cookieFor('ana', { mustChangePassword: true });
    const blocked = await http()
      .get('/probe/any')
      .set('Cookie', cookie)
      .expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await http().get('/auth/me').set('Cookie', cookie).expect(200);
    await http()
      .post('/auth/password')
      .set('Cookie', cookie)
      .set(panelHeaders())
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-pass' })
      .expect(200);
    await http().get('/probe/any').set('Cookie', cookie).expect(200);
  });

  describe('CSRF', () => {
    it('rejects cookie mutations without header or with an unlisted origin', async () => {
      const cookie = await cookieFor('ana');
      const bare = await http()
        .post('/probe/any')
        .set('Cookie', cookie)
        .expect(403);
      expect(bare.body.code).toBe('CSRF_REJECTED');
      await http()
        .post('/probe/any')
        .set('Cookie', cookie)
        .set(panelHeaders('http://evil.example'))
        .expect(403);
      await http()
        .post('/probe/any')
        .set('Cookie', cookie)
        .set({ 'x-gymtime-client': 'panel' })
        .expect(403);
    });

    it('accepts cookie mutations with header and a listed origin', async () => {
      const cookie = await cookieFor('ana');
      await http()
        .post('/probe/any')
        .set('Cookie', cookie)
        .set(panelHeaders())
        .expect(201);
    });

    it('does not ask for it on reads', async () => {
      const cookie = await cookieFor('ana');
      await http().get('/probe/any').set('Cookie', cookie).expect(200);
    });

    it('protects public mutations as well', async () => {
      await http().post('/probe/open').expect(403);
      await http().post('/probe/open').set(panelHeaders()).expect(201);
    });

    it('does not renew the session of a forged request', async () => {
      const cookie = await cookieFor('ana');
      const sessions =
        moduleRef.get<InMemorySessionsRepository>(SESSIONS_REPOSITORY);
      const touch = vi.spyOn(sessions, 'touch');
      await http().post('/probe/any').set('Cookie', cookie).expect(403);
      expect(touch).not.toHaveBeenCalled();
    });
  });

  it('rejects the session of a deactivated account at once', async () => {
    const cookie = await cookieFor('ana');
    await http().get('/probe/any').set('Cookie', cookie).expect(200);
    const users = moduleRef.get<InMemoryUsersRepository>(USERS_REPOSITORY);
    const ana = await users.findByUsername('ana');
    await users.update(ana!.id, { active: false });
    await http().get('/probe/any').set('Cookie', cookie).expect(401);
  });
});
