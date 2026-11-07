import { randomBytes } from 'node:crypto';

const ADMIN_KEY = 'admin-key-1234567890';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'a-good-password-1';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: 'device-token-123456',
  ADMIN_API_KEY: ADMIN_KEY,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  CORS_ORIGINS: ORIGIN,
  // The matrix signs in many times from one address.
  LOGIN_RATE_LIMIT: '1000',
});

const { buildInMemoryApp } = await import('./support/scenario-app.js');
const { fastHasher } = await import('../src/auth/testing.js');

type Harness = Awaited<ReturnType<typeof buildInMemoryApp>>;
type Credential = 'none' | 'assistant' | 'admin' | 'key';

const UUID = '00000000-0000-4000-8000-000000000000';

/**
 * The permission matrix of H7 (design §2): who may call what. Every route of
 * the application MUST be listed here; the completeness test fails when a new
 * route appears without a decision about its roles.
 *
 * `access` is the weakest credential that gets in: `public` (no credential),
 * `any` (a session of any role) or `admin`. `account` routes need a signed-in
 * account, so the system key is refused. `stream` never ends by itself.
 */
interface Row {
  route: string;
  access: 'public' | 'any' | 'admin';
  account?: true;
  stream?: true;
}

const MATRIX: Row[] = [
  { route: 'GET /health', access: 'public' },
  // H12: browsers ask for it by themselves; it must not log a 404.
  { route: 'GET /favicon.ico', access: 'public' },
  { route: 'POST /auth/login', access: 'public' },
  { route: 'POST /auth/logout', access: 'any', account: true },
  { route: 'GET /auth/me', access: 'any', account: true },
  { route: 'POST /auth/password', access: 'any', account: true },
  { route: 'GET /users', access: 'admin' },
  { route: 'POST /users', access: 'admin' },
  { route: 'PATCH /users/:id', access: 'admin' },
  { route: 'POST /users/:id/reset-password', access: 'admin' },
  { route: 'GET /students', access: 'any' },
  { route: 'POST /students', access: 'any' },
  { route: 'PATCH /students/:id', access: 'any' },
  { route: 'DELETE /students/:id', access: 'admin' },
  { route: 'POST /students/:id/erase', access: 'admin' },
  { route: 'POST /students/:id/enrollments', access: 'any' },
  { route: 'POST /enrollments/:id/cancel', access: 'any' },
  { route: 'GET /enrollments/:id', access: 'any' },
  { route: 'GET /attendance/open', access: 'any' },
  { route: 'GET /attendance/sessions', access: 'any' },
  { route: 'POST /attendance/entry', access: 'any' },
  { route: 'POST /attendance/exit', access: 'any' },
  { route: 'GET /alarm/status', access: 'any' },
  { route: 'POST /alarm/on', access: 'any' },
  { route: 'POST /alarm/test', access: 'any' },
  { route: 'POST /alarm/off', access: 'any' },
  { route: 'GET /devices/status', access: 'any' },
  { route: 'POST /devices/messages', access: 'any' },
  // H11: own token per device (register, rotate, revoke).
  { route: 'POST /devices', access: 'admin' },
  { route: 'POST /devices/:id/token/rotate', access: 'admin' },
  { route: 'POST /devices/:id/token/revoke', access: 'admin' },
  { route: 'POST /sync', access: 'any' },
  { route: 'GET /events', access: 'any', stream: true },
  { route: 'GET /panel/now', access: 'any' },
  { route: 'GET /panel/schedules/:id/roster', access: 'any' },
  { route: 'GET /panel/fingerprints', access: 'any' },
  { route: 'GET /schedules', access: 'any' },
  { route: 'GET /schedules/resolve', access: 'any' },
  { route: 'GET /schedules/:id', access: 'any' },
  { route: 'POST /schedules', access: 'admin' },
  { route: 'PUT /schedules/:id/students/:studentId', access: 'admin' },
  { route: 'DELETE /schedules/:id/students/:studentId', access: 'admin' },
  // H9: periods, schedules, lists, students, history and audit.
  { route: 'GET /periods', access: 'any' },
  { route: 'GET /periods/:id', access: 'any' },
  { route: 'POST /periods', access: 'admin' },
  { route: 'PATCH /periods/:id', access: 'admin' },
  { route: 'DELETE /periods/:id', access: 'admin' },
  { route: 'POST /periods/:id/activate', access: 'admin' },
  { route: 'POST /periods/:id/deactivate', access: 'admin' },
  { route: 'POST /periods/:id/exceptions', access: 'admin' },
  { route: 'PATCH /periods/:id/exceptions/:exceptionId', access: 'admin' },
  { route: 'DELETE /periods/:id/exceptions/:exceptionId', access: 'admin' },
  { route: 'PATCH /schedules/:id', access: 'admin' },
  { route: 'DELETE /schedules/:id', access: 'admin' },
  { route: 'POST /schedules/:id/students/bulk', access: 'admin' },
  { route: 'POST /schedules/:id/students/copy', access: 'admin' },
  { route: 'GET /students/consent', access: 'any' },
  { route: 'POST /students/:id/consent', access: 'any' },
  { route: 'GET /students/import/fields', access: 'admin' },
  { route: 'GET /students/import/template', access: 'admin' },
  { route: 'POST /students/import/preview', access: 'admin' },
  { route: 'POST /students/import', access: 'admin' },
  { route: 'GET /panel/students', access: 'any' },
  { route: 'GET /panel/schedules/week', access: 'any' },
  { route: 'GET /panel/attendance/history', access: 'admin' },
  { route: 'GET /audit', access: 'admin' },
  { route: 'GET /history/orders', access: 'admin' },
  { route: 'GET /history/alarms', access: 'admin' },
  // H12: offline events waiting for a person; daily operation like the manual
  // registrations, so the assistant resolves them too.
  { route: 'GET /offline/review', access: 'any' },
  { route: 'GET /offline/review/count', access: 'any' },
  { route: 'POST /offline/review/:id/resolve', access: 'any' },
  { route: 'GET /offline/clock', access: 'any' },
  // H10: reports hold personal data (absences, stay) and the CSV takes it out.
  { route: 'GET /reports/options', access: 'admin' },
  { route: 'GET /reports/summary', access: 'admin' },
  { route: 'GET /reports/flow', access: 'admin' },
  { route: 'GET /reports/attendance', access: 'admin' },
  { route: 'GET /reports/stay', access: 'admin' },
  { route: 'GET /reports/late', access: 'admin' },
  { route: 'GET /reports/alarms', access: 'admin' },
  { route: 'GET /reports/quality', access: 'admin' },
  { route: 'GET /reports/students/:id', access: 'admin' },
  { route: 'GET /reports/:kind/export', access: 'admin' },
];

/** Routes registered in the Express router of the running application. */
function registeredRoutes(app: Harness['app']): string[] {
  const express = app.getHttpAdapter().getInstance() as {
    router: {
      stack: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }>;
    };
  };
  const routes = new Set<string>();
  for (const layer of express.router.stack) {
    if (!layer.route) continue;
    // The catch-all that Nest creates for middleware (the actor context).
    if (layer.route.path === '{/*splat}') continue;
    for (const method of Object.keys(layer.route.methods)) {
      routes.add(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  return [...routes].sort();
}

const concretePath = (route: string): string => route.replace(/:\w+/g, UUID);

describe('Permission matrix (e2e, R15-R17)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await buildInMemoryApp();
  });
  afterAll(() => h.close());

  const panelHeaders = {
    'content-type': 'application/json',
    'x-gymtime-client': 'panel',
    origin: ORIGIN,
  };

  async function seed(
    username: string,
    role: 'asistente' | 'admin',
    mustChangePassword = false,
  ) {
    return h.repositories.users.create({
      name: username,
      username,
      passwordHash: await fastHasher.hash(PASSWORD),
      role,
      mustChangePassword,
    });
  }

  async function cookieOf(username: string, password = PASSWORD) {
    const res = await fetch(`${h.httpUrl}/auth/login`, {
      method: 'POST',
      headers: panelHeaders,
      body: JSON.stringify({ username, password }),
    });
    expect(res.status, `login ${username}`).toBe(200);
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith('gt_session='));
    return cookie!.split(';')[0];
  }

  /** Status of one request; streams are read up to their headers only. */
  async function call(
    route: string,
    headers: Record<string, string>,
    stream = false,
  ): Promise<number> {
    const [method, path] = route.split(' ');
    const controller = new AbortController();
    const res = await fetch(`${h.httpUrl}${concretePath(path)}`, {
      method,
      headers,
      body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
      signal: controller.signal,
    });
    if (stream) controller.abort();
    else await res.arrayBuffer();
    return res.status;
  }

  async function headersFor(
    credential: Credential,
    row: Row,
  ): Promise<Record<string, string>> {
    const write = !row.route.startsWith('GET');
    if (credential === 'key') {
      return { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY };
    }
    if (credential === 'none') return panelHeaders;
    const username = credential === 'admin' ? 'boss' : 'ana';
    const cookie = await cookieOf(username);
    return write
      ? { ...panelHeaders, cookie }
      : { 'content-type': 'application/json', cookie };
  }

  beforeAll(async () => {
    await seed('ana', 'asistente');
    await seed('boss', 'admin');
  });

  it('lists every registered route in the matrix, and only those', () => {
    const registered = registeredRoutes(h.app);
    const listed = MATRIX.map((row) => row.route).sort();
    expect(
      registered.filter((route) => !listed.includes(route)),
      'routes without a permission decision: add them to MATRIX',
    ).toEqual([]);
    expect(
      listed.filter((route) => !registered.includes(route)),
      'MATRIX rows for routes that no longer exist',
    ).toEqual([]);
  });

  describe.each(MATRIX)('$route', (row) => {
    it('without credential', async () => {
      const status = await call(
        row.route,
        await headersFor('none', row),
        row.stream,
      );
      if (row.access === 'public') {
        expect(status).not.toBe(401);
        // The login is a mutation: it is guarded against CSRF, not by roles.
        expect(status).not.toBe(403);
      } else {
        expect(status).toBe(401);
      }
    });

    it('as an assistant', async () => {
      const status = await call(
        row.route,
        await headersFor('assistant', row),
        row.stream,
      );
      expect(status).not.toBe(401);
      if (row.access === 'admin') expect(status).toBe(403);
      else expect(status).not.toBe(403);
    });

    it('as an admin', async () => {
      const status = await call(
        row.route,
        await headersFor('admin', row),
        row.stream,
      );
      expect(status).not.toBe(401);
      expect(status).not.toBe(403);
    });

    it('with the system key (CLI)', async () => {
      const status = await call(
        row.route,
        await headersFor('key', row),
        row.stream,
      );
      if (row.access === 'public' && row.route !== 'GET /health') return;
      expect(status).not.toBe(401);
      if (row.account) expect(status).toBe(403);
      else expect(status).not.toBe(403);
    });
  });

  it('serves the state endpoints with the cookie (R20)', async () => {
    const cookie = await cookieOf('ana');
    for (const path of [
      '/attendance/open',
      '/devices/status',
      '/alarm/status',
    ]) {
      const res = await fetch(`${h.httpUrl}${path}`, { headers: { cookie } });
      expect(res.status, path).toBe(200);
    }
  });

  it('opens the event stream with the cookie from an allowed origin (R20, R19)', async () => {
    const cookie = await cookieOf('ana');
    const controller = new AbortController();
    const res = await fetch(`${h.httpUrl}/events`, {
      headers: { cookie, origin: ORIGIN },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    controller.abort();
  });

  it('gives no CORS headers to an unlisted origin and answers the preflight of a listed one', async () => {
    const other = await fetch(`${h.httpUrl}/health`, {
      headers: { origin: 'http://evil.example' },
    });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(`${h.httpUrl}/students`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-gymtime-client',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(preflight.headers.get('access-control-max-age')).toBe('600');
  });

  describe('login -> cookie -> mutation with CSRF', () => {
    const student = (document: string) =>
      JSON.stringify({ document, name: 'Ana Gomez', consented: true });

    it('requires the client header and an allowed origin on cookie mutations', async () => {
      const cookie = await cookieOf('ana');
      const post = (headers: Record<string, string>, document: string) =>
        fetch(`${h.httpUrl}/students`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie, ...headers },
          body: student(document),
        });
      expect((await post({}, '1')).status).toBe(403);
      expect((await post({ 'x-gymtime-client': 'panel' }, '1')).status).toBe(
        403,
      );
      expect(
        (
          await post(
            { 'x-gymtime-client': 'panel', origin: 'http://evil.example' },
            '1',
          )
        ).status,
      ).toBe(403);
      expect(
        (await post({ 'x-gymtime-client': 'panel', origin: ORIGIN }, '1'))
          .status,
      ).toBe(201);
    });

    it('lets the CLI mutate with only the key', async () => {
      const res = await fetch(`${h.httpUrl}/students`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
        body: student('2'),
      });
      expect(res.status).toBe(201);
    });

    it('rejects a wrong key even with a valid cookie', async () => {
      const cookie = await cookieOf('ana');
      const res = await fetch(`${h.httpUrl}/students`, {
        headers: { cookie, 'x-api-key': 'wrong-key-123456789' },
      });
      expect(res.status).toBe(401);
    });

    it('attributes the audit to the user, or to the system for the key (R22)', async () => {
      const ana = await h.repositories.users.findByUsername('ana');
      const entries = h.repositories.eventLog.entries.filter(
        (e) => e.type === 'student.created',
      );
      expect(entries).toHaveLength(2);
      expect(entries[0].actor).toEqual({ type: 'user', id: ana!.id });
      expect(entries[1].actor).toEqual({ type: 'system', id: null });
    });
  });

  describe('account lifecycle', () => {
    it('blocks a temporary password everywhere but the password routes (R6)', async () => {
      await seed('newbie', 'asistente', true);
      const cookie = await cookieOf('newbie');
      const students = await fetch(`${h.httpUrl}/students`, {
        headers: { cookie },
      });
      expect(students.status).toBe(403);
      expect((await students.json()).code).toBe('PASSWORD_CHANGE_REQUIRED');
      const me = await fetch(`${h.httpUrl}/auth/me`, { headers: { cookie } });
      expect(me.status).toBe(200);
      expect((await me.json()).mustChangePassword).toBe(true);
    });

    it('revokes the session at once when the admin deactivates the account (R13)', async () => {
      const victim = await seed('temp', 'asistente');
      const cookie = await cookieOf('temp');
      const adminCookie = await cookieOf('boss');
      expect(
        (await fetch(`${h.httpUrl}/students`, { headers: { cookie } })).status,
      ).toBe(200);
      const res = await fetch(`${h.httpUrl}/users/${victim.id}`, {
        method: 'PATCH',
        headers: { ...panelHeaders, cookie: adminCookie },
        body: JSON.stringify({ active: false }),
      });
      expect(res.status).toBe(200);
      expect(
        (await fetch(`${h.httpUrl}/students`, { headers: { cookie } })).status,
      ).toBe(401);
    });
  });
});
