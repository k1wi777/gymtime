import { randomBytes } from 'node:crypto';

const ADMIN_KEY = 'admin-key-1234567890';
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: 'device-token-123456',
  ADMIN_API_KEY: ADMIN_KEY,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});
const { buildInMemoryApp } = await import('./support/scenario-app.js');

type Harness = Awaited<ReturnType<typeof buildInMemoryApp>>;

/** Admin panel reads (H9): students, week view, history and audit. */
describe('Admin panel reads (e2e)', () => {
  let h: Harness;
  let studentId: string;
  let periodId: string;
  let scheduleId: string;
  const get = (path: string) => h.http().get(path).set(h.auth);
  const post = (path: string, body?: object) =>
    h.http().post(path).set(h.auth).send(body);

  beforeEach(async () => {
    h = await buildInMemoryApp();
    studentId = (
      await post('/students', {
        document: '1001',
        name: 'Ana Gomez',
        program: 'Ingenieria',
        consented: true,
      }).expect(201)
    ).body.id;
    await post('/students', {
      document: '1002',
      name: 'Luis Mora',
      program: 'Medicina',
    }).expect(201);
    periodId = (
      await post('/periods', {
        name: '2026-2',
        startDate: '2026-11-02',
        endDate: '2026-11-27',
      }).expect(201)
    ).body.id;
    await post(`/periods/${periodId}/activate`).expect(200);
    await post(`/periods/${periodId}/exceptions`, {
      from: '2026-11-04',
      to: '2026-11-04',
      reason: 'Festivo',
    }).expect(201);
    scheduleId = (
      await post('/schedules', {
        name: 'Lunes',
        weekday: 1,
        start: '08:45',
        end: '09:45',
        periodId,
      }).expect(201)
    ).body.id;
    await h
      .http()
      .put(`/schedules/${scheduleId}/students/${studentId}`)
      .set(h.auth)
      .expect((res) => expect(res.status).toBeLessThan(300));
  });

  afterEach(() => h.close());

  it('lists students with search and fingerprint filter', async () => {
    const all = (await get('/panel/students').expect(200)).body;
    expect(all.total).toBe(2);
    const found = (await get('/panel/students?search=luis').expect(200)).body;
    expect(found.items.map((s: { name: string }) => s.name)).toEqual([
      'Luis Mora',
    ]);
    expect(found.items[0].consented).toBe(false);
    const enrolled = (
      await get('/panel/students?fingerprint=enrolled').expect(200)
    ).body;
    expect(enrolled.total).toBe(0);
    const none = (await get('/panel/students?fingerprint=none').expect(200))
      .body;
    expect(none.total).toBe(2);
    await get('/panel/students?limit=0').expect(400);
  });

  it('shows the week with the day without service and the assigned count', async () => {
    const week = (
      await get(
        `/panel/schedules/week?periodId=${periodId}&weekStart=2026-11-02`,
      ).expect(200)
    ).body;
    expect(week.period.name).toBe('2026-2');
    expect(week.days).toHaveLength(7);
    const wednesday = week.days.find(
      (d: { date: string }) => d.date === '2026-11-04',
    );
    expect(wednesday.closedReason).toBe('Festivo');
    expect(week.days[0].closedReason).toBeNull();
    expect(week.schedules).toEqual([
      expect.objectContaining({ name: 'Lunes', weekday: 1, assignedCount: 1 }),
    ]);
  });

  it('filters the attendance history and names who registered by hand', async () => {
    await post('/attendance/entry', {
      studentId,
      reason: 'El lector no respondia',
    }).expect(201);
    const page = (await get('/panel/attendance/history').expect(200)).body;
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      student: { name: 'Ana Gomez' },
      schedule: { name: 'Lunes' },
      entrySource: 'manual',
      manualReason: 'El lector no respondia',
      status: 'abierta',
    });
    expect(page.items[0].entryBy).toMatchObject({ type: 'system' });
    const byDevice = (
      await get('/panel/attendance/history?source=device').expect(200)
    ).body;
    expect(byDevice.total).toBe(0);
    const bySearch = (
      await get('/panel/attendance/history?search=ana').expect(200)
    ).body;
    expect(bySearch.total).toBe(1);
    await get('/panel/attendance/history?source=x').expect(400);
  });

  it('paginates the audit trail and keeps contact data out', async () => {
    await post('/students', {
      document: '1003',
      name: 'Eva',
      email: 'eva@example.com',
      phone: '3001234567',
    }).expect(201);
    const first = (await get('/audit?limit=2').expect(200)).body;
    expect(first.items).toHaveLength(2);
    expect(first.nextBefore).toEqual(expect.any(Number));
    const second = (
      await get(`/audit?limit=2&before=${first.nextBefore}`).expect(200)
    ).body;
    expect(second.items[0].id).toBeLessThan(first.items[1].id);
    const created = (
      await get('/audit?type=student.created&limit=200').expect(200)
    ).body;
    expect(created.items.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(created)).not.toMatch(/eva@example|3001234567/);
    const periods = (await get('/audit?type=period.created').expect(200)).body;
    expect(periods.items).toHaveLength(1);
  });

  it('lists the orders and the alarm history', async () => {
    await post('/alarm/on').catch(() => undefined);
    const orders = await get('/history/orders').expect(200);
    expect(Array.isArray(orders.body.items)).toBe(true);
    const alarms = await get('/history/alarms').expect(200);
    expect(alarms.body).toMatchObject({ items: expect.any(Array) });
  });
});
