import { randomBytes } from 'node:crypto';

const TOKEN = 'device-token-123456';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: TOKEN,
  ADMIN_API_KEY: 'admin-key-1234567890',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

const { startScenarioApp } = await import('./support/scenario-app.js');

type Harness = Awaited<ReturnType<typeof startScenarioApp>>;

/** B14: an erased student leaves the reader at the next sync. */
describe('Data erasure with the simulator (e2e, B14)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startScenarioApp();
  });
  afterEach(() => h.close());

  async function setup() {
    const ana = await h.createEnrolledStudent('111', 'Ana');
    const bea = await h.createEnrolledStudent('222', 'Bea');
    const scheduleId = await h.createSchedule({
      name: 'A',
      start: '10:00',
      end: '11:00',
    });
    await h.assign(scheduleId, ana);
    await h.assign(scheduleId, bea);
    h.setNow('10:05');
    return { ana, bea };
  }

  const erase = (id: string, document: string) =>
    h
      .http()
      .post(`/students/${id}/erase`)
      .set(h.auth)
      .send({ confirmDocument: document });

  it('drops the fingerprint from a connected reader after the erasure sync', async () => {
    await h.startDevice();
    const { ana, bea } = await setup();
    expect(await h.sync()).toMatchObject({ status: 'ok', templates: 2 });
    expect(h.device().reader.slots).toHaveLength(2);

    const res = await erase(ana, '111').expect(200);
    expect(res.body).toEqual({ studentId: ana, templatesDeleted: 1 });

    await vi.waitFor(() => expect(h.device().reader.slots).toHaveLength(1), {
      timeout: 3000,
    });
    // Bea keeps her slot; Ana's personal data is gone from the database.
    await expect(h.resolveSlot(bea)).resolves.toBeGreaterThan(0);
    const stored = h.repositories.fingerprints.all();
    expect(stored.map((f) => f.studentId)).toEqual([bea]);
    const row = await h.repositories.students.findById(ana);
    expect(row).toMatchObject({
      name: 'Estudiante anonimizado',
      active: false,
    });
    expect(JSON.stringify(row)).not.toContain('111');
  });

  it('drops it after reconnection when the reader was offline during the erasure', async () => {
    await h.startDevice();
    const { ana, bea } = await setup();
    await h.sync();
    expect(h.device().reader.slots).toHaveLength(2);
    await h.stopDevice();

    await erase(ana, '111').expect(200);
    await erase(ana, '111').expect(409); // the document is now ANON-...: confirmation no longer matches
    await h
      .http()
      .post(`/students/${ana}/erase`)
      .set(h.auth)
      .send({ reapply: true })
      .expect(200);

    // The reader keeps its old content until it connects again...
    await h.startDevice();
    // ...and the 'connected' sync leaves only Bea.
    await vi.waitFor(() => expect(h.device().reader.slots).toHaveLength(1), {
      timeout: 4000,
    });
    await expect(h.resolveSlot(bea)).resolves.toBeGreaterThan(0);
  });

  it('keeps the sessions of the erased student', async () => {
    await h.startDevice();
    const { ana } = await setup();
    await h.sync();
    h.device().scan(await h.resolveSlot(ana));
    await h.waitForFrame('scan.result', (m) => m.payload.result === 'entry');
    expect(await h.sessions()).toHaveLength(1);

    await erase(ana, '111').expect(200);

    const sessions = await h.sessions();
    expect(sessions).toHaveLength(1);
    expect(JSON.stringify(sessions)).not.toContain('"Ana"');
  });
});
