import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * In-memory GymTime server for the panel's browser tests (Playwright).
 *
 * It is the real `AppModule` on in-memory repositories (no PostgreSQL), with
 * CORS open to the panel at http://localhost:3000, the real simulator as the
 * reader and a movable clock. A small control server on 127.0.0.1:3002 lets
 * the tests do what a person would do next to the reader: scan a finger, move
 * the clock, cut the reader or restart the API. It lives in `test/` and runs
 * under vitest because the server code needs decorator metadata that `tsx`
 * does not emit; nothing of this ships in `dist` or in the Nest application.
 */
const API_PORT = Number(process.env.PANEL_API_PORT ?? 3001);
const CONTROL_PORT = Number(process.env.PANEL_CONTROL_PORT ?? 3002);
const PANEL_ORIGIN = process.env.PANEL_ORIGIN ?? 'http://localhost:3000';
const ADMIN_KEY = 'panel-harness-admin-key';
const DEVICE_TOKEN = 'panel-harness-device-token';
export const PASSWORD = 'Clave-de-prueba-1';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN,
  ADMIN_API_KEY: ADMIN_KEY,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  CORS_ORIGINS: PANEL_ORIGIN,
  // Many tests sign in from one address.
  LOGIN_RATE_LIMIT: '1000',
});

const { buildInMemoryApp, bogotaAt } =
  await import('../support/scenario-app.js');
type InMemoryApp = Awaited<ReturnType<typeof buildInMemoryApp>>;
const { DeviceClient } = await import('@gymtime/simulator');
const { fastHasher } = await import('../../src/auth/testing.js');
const { SyncService } = await import('../../src/sync/sync.service.js');
const { buildSemester, SEMESTER_NOW } =
  await import('../../src/reports/seed/semester.js');
const { loadSemesterInMemory } =
  await import('../../src/reports/seed/load-memory.js');

type Device = InstanceType<typeof DeviceClient>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const quietLogger = {
  frame: () => undefined,
  state: () => undefined,
  warn: () => undefined,
};

/** Mutated by the control server: the simulator reads it at every enrollment. */
const enroll = {
  mode: 'ok' as 'ok' | 'fail' | 'silent',
  stepMs: 5,
  failReason: 'sim_fail',
  templateBytes: 512,
};

interface World {
  app: InMemoryApp;
  device: Device | null;
  students: Record<string, { id: string; document: string; name: string }>;
  scheduleId: string;
  laterScheduleId: string;
}

let world: World | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** Operations run one at a time: a reset must not race a scan. */
const serial = <T>(task: () => Promise<T>): Promise<T> => {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
};

async function api(
  app: InMemoryApp,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${app.httpUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function startDevice(app: InMemoryApp): Promise<Device> {
  const device = new DeviceClient(
    {
      url: app.wsUrl,
      deviceId: 'esp32-panel-01',
      token: DEVICE_TOKEN,
      fw: 'panel-e2e-1.0',
      enroll,
    },
    quietLogger,
  );
  device.start();
  for (let i = 0; i < 200 && device.state !== 'online'; i++) await sleep(25);
  if (device.state !== 'online')
    throw new Error('the simulated reader did not connect');
  return device;
}

async function seed(app: InMemoryApp): Promise<Omit<World, 'app' | 'device'>> {
  for (const [username, role, mustChange] of [
    ['boss', 'admin', false],
    ['ana', 'asistente', false],
    ['nueva', 'asistente', true],
  ] as const) {
    await app.repositories.users.create({
      name:
        username === 'ana'
          ? 'Ana Asistente'
          : username === 'boss'
            ? 'Jefe Admin'
            : 'Nueva Asistente',
      username,
      passwordHash: await fastHasher.hash(PASSWORD),
      role,
      mustChangePassword: mustChange,
    });
  }
  return { students: {}, scheduleId: '', laterScheduleId: '' };
}

async function build(previous?: World, startAt?: Date): Promise<World> {
  const app = await buildInMemoryApp({
    port: API_PORT,
    host: '::',
    now: previous ? previous.app.clock.now() : (startAt ?? bogotaAt('10:00')),
    repositories: previous?.app.repositories,
    enrollTimeoutSec: 60,
    alarm: { tickMs: 50 },
  });
  const device = await startDevice(app);
  return { ...(previous ?? (await seed(app))), app, device };
}

async function populate(w: World): Promise<void> {
  const { app } = w;
  const create = async (document: string, name: string, consented = true) => {
    const res = await api(app, 'POST', '/students', {
      document,
      name,
      consented,
    });
    w.students[document] = { id: res.json.id, document, name };
    return res.json.id as string;
  };
  const ids = {
    ana: await create('1001', 'Ana Gómez'),
    beto: await create('1002', 'Beto Ruiz'),
    carla: await create('1003', 'Carla Díaz'),
  };
  await create('1004', 'Diego Sin Huella');
  await create('1005', 'Eva Sin Consentimiento', false);

  for (const id of Object.values(ids)) {
    const started = await api(app, 'POST', `/students/${id}/enrollments`, {});
    for (let i = 0; i < 200; i++) {
      const state = await api(app, 'GET', `/enrollments/${started.json.id}`);
      if (state.json.status === 'done') break;
      await sleep(20);
    }
  }
  const schedule = await api(app, 'POST', '/schedules', {
    name: 'Grupo A',
    date: '2026-11-02',
    start: '09:00',
    end: '11:00',
  });
  w.scheduleId = schedule.json.id;
  for (const id of Object.values(ids)) {
    await api(app, 'PUT', `/schedules/${w.scheduleId}/students/${id}`);
  }
  const later = await api(app, 'POST', '/schedules', {
    name: 'Grupo B',
    date: '2026-11-02',
    start: '14:00',
    end: '15:00',
  });
  w.laterScheduleId = later.json.id;
  await api(
    app,
    'PUT',
    `/schedules/${w.laterScheduleId}/students/${w.students['1004']?.id}`,
  );
  await api(app, 'POST', '/sync');
}

/** Open SSE streams would keep `close()` waiting forever: drop them first. */
async function shutdown(app: {
  app: { getHttpServer(): Server };
  close(): Promise<void>;
}): Promise<void> {
  app.app.getHttpServer().closeAllConnections();
  await app.close();
}

async function freshWorld(): Promise<World> {
  if (world) {
    await world.device?.stop();
    await shutdown(world.app);
    world = null;
  }
  enroll.mode = 'ok';
  enroll.stepMs = 5;
  const w = await build();
  await populate(w);
  // From now on enrollments are slow enough to watch step by step.
  enroll.stepMs = 400;
  world = w;
  return w;
}

/**
 * The simulated semester (reports, H10): a world whose clock is the end of the
 * semester and whose repositories hold the deterministic dataset. The browser
 * tests compare the panel against `semester.expected.json`.
 */
async function semesterWorld(): Promise<World> {
  if (world) {
    await world.device?.stop();
    await shutdown(world.app);
    world = null;
  }
  const w = await build(undefined, SEMESTER_NOW);
  loadSemesterInMemory(buildSemester(), w.app.repositories);
  world = w;
  return w;
}

async function slotOf(w: World, studentId: string): Promise<number> {
  const sync = w.app.app.get(SyncService);
  for (const slot of w.device?.reader.slots ?? []) {
    const found = await sync.findStudentBySlot('esp32-panel-01', slot);
    if (found?.id === studentId) return slot;
  }
  throw new Error(`student ${studentId} has no slot in the reader`);
}

function readJson(request: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (c: Buffer) => chunks.push(c));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function control(path: string, body: any): Promise<unknown> {
  switch (path) {
    case '/control/reset': {
      const w = await freshWorld();
      return {
        students: w.students,
        scheduleId: w.scheduleId,
        laterScheduleId: w.laterScheduleId,
        password: PASSWORD,
      };
    }
    case '/control/semester': {
      await semesterWorld();
      return { now: SEMESTER_NOW.toISOString(), password: PASSWORD };
    }
    case '/control/scan': {
      const w = world!;
      const student = w.students[String(body.document)];
      if (!student)
        throw new Error(`unknown document ${String(body.document)}`);
      w.device!.scan(await slotOf(w, student.id));
      return { ok: true };
    }
    case '/control/clock': {
      world!.app.clock.set(bogotaAt(String(body.time)));
      return { now: world!.app.clock.now().toISOString() };
    }
    case '/control/enroll': {
      if (body.mode) enroll.mode = body.mode;
      if (body.stepMs !== undefined) enroll.stepMs = Number(body.stepMs);
      return { ...enroll };
    }
    case '/control/device': {
      const w = world!;
      if (body.online === false) {
        await w.device?.stop();
        w.device = null;
        // The server notices the closed socket on its own; give it a moment.
        await sleep(150);
      } else if (!w.device) {
        w.device = await startDevice(w.app);
      }
      return { online: w.device !== null };
    }
    case '/control/api-restart': {
      // The same repositories: sessions and data survive, the sockets do not.
      const old = world!;
      await old.device?.stop();
      await shutdown(old.app);
      await sleep(Number(body.downMs ?? 0));
      world = await build(old);
      return { ok: true };
    }
    case '/control/sessions': {
      const res = await api(
        world!.app,
        'GET',
        '/attendance/sessions?limit=200',
      );
      return res.json;
    }
    default:
      throw Object.assign(new Error('not found'), { status: 404 });
  }
}

function startControlServer(): Server {
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/control/health') {
      send(world ? 200 : 503, { ready: world !== null });
      return;
    }
    readJson(request)
      .then((body) => serial(() => control(url.pathname, body)))
      .then((result) => send(200, result))
      .catch((error: unknown) => {
        const status = (error as { status?: number }).status ?? 500;
        send(status, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
  server.listen(CONTROL_PORT, '127.0.0.1');
  return server;
}

describe('panel harness', () => {
  it('serves the in-memory API and the control server until it is stopped', async () => {
    await freshWorld();
    const server = startControlServer();
    process.stdout.write(
      `panel harness ready: API http://localhost:${API_PORT}, control http://127.0.0.1:${CONTROL_PORT}\n`,
    );
    await new Promise<void>((resolve) => {
      const stop = () => {
        server.close();
        resolve();
      };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
    });
    await world?.device?.stop();
    if (world) await shutdown(world.app);
    // Nothing else keeps the process alive after this.
    process.exit(0);
  });
});
