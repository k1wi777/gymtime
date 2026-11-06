import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../auth/auth.service.js';
import { defaultAuthConfig } from '../auth/auth.config.js';
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  authTestProviders,
  panelHeaders,
  seedAccount,
  signInAs,
} from '../auth/testing.js';
import { SYSTEM_ACTOR, runAsActor } from '../common/audit/actor.js';
import { EVENT_LOG_REPOSITORY } from '../common/audit/event-log.repository.js';
import type { InMemoryEventLogRepository } from '../common/audit/in-memory-event-log.repository.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

const KEY = { 'x-api-key': defaultAuthConfig.adminApiKey };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('UsersController (R11-R14, R22, R23)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  const http = () => request(app.getHttpServer());
  const auditLog = () =>
    moduleRef.get<InMemoryEventLogRepository>(EVENT_LOG_REPOSITORY).entries;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        ...authTestProviders({ corsOrigins: [TEST_ORIGIN] }),
        UsersService,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    // What ActorMiddleware does in the real application.
    app.use((_req: unknown, _res: unknown, next: () => void) =>
      runAsActor(SYSTEM_ACTOR, next),
    );
    await app.init();
  });

  afterEach(() => app.close());

  const create = (cookie: string, body: object) =>
    http().post('/users').set('Cookie', cookie).set(panelHeaders()).send(body);

  it('is closed to anonymous callers and to assistants', async () => {
    const assistant = await signInAs(moduleRef, 'ana', 'asistente');
    await http().get('/users').expect(401);
    for (const [method, url] of [
      ['get', '/users'],
      ['post', '/users'],
      ['patch', `/users/${UNKNOWN_ID}`],
      ['post', `/users/${UNKNOWN_ID}/reset-password`],
    ] as const) {
      const res = await http()
        [method](url)
        .set('Cookie', assistant)
        .set(panelHeaders())
        .send({});
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('creates an account with a one-time temporary password', async () => {
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    const res = await create(admin, {
      name: 'Ana Gómez',
      username: '  Ana.Gomez ',
      role: 'asistente',
    }).expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      name: 'Ana Gómez',
      username: 'ana.gomez',
      role: 'asistente',
      active: true,
      mustChangePassword: true,
    });
    expect(res.body.temporaryPassword).toHaveLength(16);
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/);

    const login = await moduleRef.get(AuthService).login({
      username: 'ana.gomez',
      password: res.body.temporaryPassword,
      ip: '1.1.1.1',
    });
    expect(login.account.mustChangePassword).toBe(true);
  });

  it('lists accounts without hashes or counters', async () => {
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    await seedAccount(moduleRef, 'ana');
    const res = await http().get('/users').set('Cookie', admin).expect(200);
    expect(res.body.map((u: { username: string }) => u.username)).toEqual([
      'ana',
      'boss',
    ]);
    for (const user of res.body) {
      expect(Object.keys(user).sort()).toEqual([
        'active',
        'createdAt',
        'id',
        'lastLoginAt',
        'mustChangePassword',
        'name',
        'role',
        'username',
      ]);
    }
  });

  it('rejects a duplicate and an invalid username or role', async () => {
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    const body = { name: 'Ana', username: 'ana', role: 'asistente' };
    await create(admin, body).expect(201);
    const dup = await create(admin, { ...body, username: 'ANA' }).expect(409);
    expect(dup.body.code).toBe('USERNAME_TAKEN');
    await create(admin, { ...body, username: 'a b' }).expect(400);
    await create(admin, { ...body, username: 'ab' }).expect(400);
    await create(admin, { ...body, role: 'root' }).expect(400);
    await create(admin, { ...body, password: 'chosen-by-admin' }).expect(400);
  });

  it('edits name and role of another account', async () => {
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    const ana = await seedAccount(moduleRef, 'ana');
    const res = await http()
      .patch(`/users/${ana.id}`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .send({ name: 'Ana B.', role: 'admin' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Ana B.', role: 'admin' });
    await http()
      .patch(`/users/${ana.id}`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .send({})
      .expect(400);
    await http()
      .patch(`/users/${UNKNOWN_ID}`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .send({ name: 'x' })
      .expect(404);
  });

  it('does not let an admin deactivate themselves or change their own role (R14)', async () => {
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    const me = (await moduleRef
      .get(AuthService)
      .authenticate(admin.split('=')[1]))!;
    const patch = (body: object) =>
      http()
        .patch(`/users/${me.account.id}`)
        .set('Cookie', admin)
        .set(panelHeaders())
        .send(body);
    expect((await patch({ active: false }).expect(409)).body.code).toBe(
      'SELF_CHANGE_FORBIDDEN',
    );
    await patch({ role: 'asistente' }).expect(409);
    await patch({ name: 'The Boss', role: 'admin', active: true }).expect(200);
  });

  it('deactivation signs the user out at once; reactivation allows signing in again (R13)', async () => {
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    const ana = await seedAccount(moduleRef, 'ana');
    const auth = moduleRef.get(AuthService);
    const { token } = await auth.login({
      username: 'ana',
      password: TEST_PASSWORD,
      ip: '1.1.1.1',
    });
    expect(await auth.authenticate(token)).not.toBeNull();
    await http()
      .patch(`/users/${ana.id}`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .send({ active: false })
      .expect(200);
    expect(await auth.authenticate(token)).toBeNull();
    await expect(
      auth.login({ username: 'ana', password: TEST_PASSWORD, ip: '1.1.1.1' }),
    ).rejects.toThrow();
    await http()
      .patch(`/users/${ana.id}`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .send({ active: true })
      .expect(200);
    await expect(
      auth.login({ username: 'ana', password: TEST_PASSWORD, ip: '1.1.1.1' }),
    ).resolves.toBeDefined();
  });

  it('resets the password: new temporary one, old sessions and password die (R12)', async () => {
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    const ana = await seedAccount(moduleRef, 'ana');
    const auth = moduleRef.get(AuthService);
    const old = await auth.login({
      username: 'ana',
      password: TEST_PASSWORD,
      ip: '1.1.1.1',
    });
    const res = await http()
      .post(`/users/${ana.id}/reset-password`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      username: 'ana',
      mustChangePassword: true,
    });
    expect(await auth.authenticate(old.token)).toBeNull();
    await expect(
      auth.login({ username: 'ana', password: TEST_PASSWORD, ip: '1.1.1.1' }),
    ).rejects.toThrow();
    const fresh = await auth.login({
      username: 'ana',
      password: res.body.temporaryPassword,
      ip: '1.1.1.1',
    });
    expect(fresh.account.mustChangePassword).toBe(true);
    await http()
      .post(`/users/${UNKNOWN_ID}/reset-password`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .expect(404);
  });

  it('attributes the audit entries to the administrator and keeps secrets out', async () => {
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    const bossId = (await moduleRef
      .get(AuthService)
      .authenticate(admin.split('=')[1]))!.account.id;
    const created = await create(admin, {
      name: 'Ana',
      username: 'ana',
      role: 'asistente',
    }).expect(201);
    await http()
      .patch(`/users/${created.body.id}`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .send({ role: 'admin' })
      .expect(200);
    await http()
      .patch(`/users/${created.body.id}`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .send({ active: false })
      .expect(200);
    const reset = await http()
      .post(`/users/${created.body.id}/reset-password`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .expect(200);

    const entries = auditLog().filter((e) => e.type.startsWith('user.'));
    expect(entries.map((e) => e.type)).toEqual([
      'user.created',
      'user.updated',
      'user.deactivated',
      'user.password_reset',
    ]);
    expect(
      entries.every((e) => e.actor.type === 'user' && e.actor.id === bossId),
    ).toBe(true);
    expect(entries.every((e) => e.detail?.userId === created.body.id)).toBe(
      true,
    );
    const text = JSON.stringify(auditLog());
    expect(text).not.toContain(created.body.temporaryPassword);
    expect(text).not.toContain(reset.body.temporaryPassword);
    expect(text).not.toMatch(/argon2/);
  });

  it('works with the system credential', async () => {
    const res = await http()
      .post('/users')
      .set(KEY)
      .send({ name: 'Ana', username: 'ana', role: 'asistente' })
      .expect(201);
    await http().get('/users').set(KEY).expect(200);
    expect(res.body.mustChangePassword).toBe(true);
  });

  describe('last administrator (E21-2)', () => {
    const patchAs = (
      credential: Record<string, string>,
      id: string,
      body: object,
    ) =>
      http()
        .patch(`/users/${id}`)
        .set(credential)
        .set(panelHeaders())
        .send(body);

    it('refuses to deactivate or demote the only active administrator, even with the system key', async () => {
      const only = await seedAccount(moduleRef, 'only', { role: 'admin' });
      const deactivate = await patchAs(KEY, only.id, { active: false });
      expect(deactivate.status).toBe(409);
      expect(deactivate.body.code).toBe('LAST_ADMIN');
      expect(deactivate.body.message).toMatch(/último administrador/);
      const demote = await patchAs(KEY, only.id, { role: 'asistente' });
      expect(demote.body.code).toBe('LAST_ADMIN');
      expect(auditLog().filter((e) => e.type === 'user.deactivated')).toEqual(
        [],
      );
    });

    it('does not count deactivated administrators, and allows it with another active one', async () => {
      const a = await seedAccount(moduleRef, 'a', { role: 'admin' });
      await seedAccount(moduleRef, 'gone', { role: 'admin', active: false });
      expect((await patchAs(KEY, a.id, { active: false })).body.code).toBe(
        'LAST_ADMIN',
      );
      const b = await seedAccount(moduleRef, 'b', { role: 'admin' });
      await patchAs(KEY, a.id, { active: false }).expect(200);
      expect((await patchAs(KEY, b.id, { role: 'asistente' })).body.code).toBe(
        'LAST_ADMIN',
      );
    });

    it('lets assistants change freely: only administrators are protected', async () => {
      await seedAccount(moduleRef, 'boss', { role: 'admin' });
      const ana = await seedAccount(moduleRef, 'ana');
      await patchAs(KEY, ana.id, { active: false }).expect(200);
    });

    it('two administrators deactivating each other at once leave at least one', async () => {
      const a = await seedAccount(moduleRef, 'a', { role: 'admin' });
      const b = await seedAccount(moduleRef, 'b', { role: 'admin' });
      const results = await Promise.all([
        patchAs(KEY, a.id, { active: false }),
        patchAs(KEY, b.id, { active: false }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const accounts = await http().get('/users').set(KEY).expect(200);
      expect(
        accounts.body.filter((u: { active: boolean }) => u.active),
      ).toHaveLength(1);
    });
  });
});
