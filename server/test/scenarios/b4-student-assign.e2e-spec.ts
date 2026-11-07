import { randomBytes } from 'node:crypto';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: 'device-token-123456',
  ADMIN_API_KEY: 'admin-key-1234567890',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

const { startScenarioApp } = await import('../support/scenario-app.js');

type Harness = Awaited<ReturnType<typeof startScenarioApp>>;

/** B4 end to end: manual registration, listing and assignment to a schedule. */
describe('B4 — manual student registration (e2e)', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startScenarioApp();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('B4 — a student created by hand shows in the list and can be assigned to a schedule', async () => {
    const created = await harness
      .http()
      .post('/students')
      .set(harness.auth)
      .send({
        document: '1002003004',
        name: 'Ana Gomez',
        email: 'ana@example.edu',
        phone: '3001234567',
        consented: true,
      })
      .expect(201);
    const id = created.body.id as string;

    const list = await harness
      .http()
      .get('/students')
      .set(harness.auth)
      .expect(200);
    const rows = (list.body.items ?? list.body) as Array<{ id: string }>;
    expect(rows.map((row) => row.id)).toContain(id);

    const scheduleId = await harness.createSchedule({
      name: 'B4',
      start: '10:00',
      end: '11:00',
    });
    await harness.assign(scheduleId, id);

    const assigned = await harness
      .http()
      .get(`/schedules/${scheduleId}`)
      .set(harness.auth)
      .expect(200);
    expect(JSON.stringify(assigned.body)).toContain(id);
  });
});
