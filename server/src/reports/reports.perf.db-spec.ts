import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { expectedFor } from './seed/expected.js';
import { databaseName } from './seed/safety.js';
import { SEMESTER_NOW, buildSemester } from './seed/semester.js';

/** Time budget of every report over the semester x20 (design section 6). */
const BUDGET_MS = 1500;
const url = process.env.DATABASE_URL ?? '';
const SCALE = Number(process.env.V15_SCALE ?? 20);

describe.runIf(
  process.env.V15_PHASE === 'perf' &&
    /reports_check/.test(databaseName(url || 'postgresql://x/x')),
)('V15 reports over PostgreSQL (x20)', () => {
  type Service = import('./reports.service.js').ReportsService;
  let reports: Service;
  let close: () => Promise<void>;
  const dataset = buildSemester({ scale: SCALE });
  const expected = expectedFor(dataset, SEMESTER_NOW);

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DEVICE_TOKEN: 'device-token-123456',
      ADMIN_API_KEY: 'admin-key-1234567890',
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });
    const { AppModule } = await import('../app.module.js');
    const { CLOCK } = await import('../common/time/clock.js');
    const { ReportsService } = await import('./reports.service.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue({ now: () => SEMESTER_NOW })
      .compile();
    reports = moduleRef.get(ReportsService);
    close = () => moduleRef.close();
    await reports.options(); // warm up the connection
  });
  afterAll(() => close?.());

  const timed = async <T>(label: string, run: () => Promise<T>) => {
    const started = performance.now();
    const result = await run();
    const ms = Math.round(performance.now() - started);
    console.log(`V15 ${label}: ${ms} ms`);
    expect(ms, `${label} exceeded the budget`).toBeLessThan(BUDGET_MS);
    return result;
  };

  it('every report stays inside the budget and agrees with the oracle', async () => {
    const flow = await timed('flow', () => reports.flow({}));
    expect(flow.total).toBe(expected.flow.total);
    expect(flow.byHour.map((b) => b.count)).toEqual(expected.flow.byHour);
    const attendance = await timed('attendance/student', () =>
      reports.attendanceReport({}),
    );
    expect(attendance.meta.obligations).toBe(expected.attendance.obligations);
    expect(attendance.meta.attended).toBe(expected.attendance.attended);
    await timed('attendance/schedule', () =>
      reports.attendanceReport({ groupBy: 'schedule' }),
    );
    await timed('attendance/month', () =>
      reports.attendanceReport({ groupBy: 'month' }),
    );
    await timed('stay', () => reports.stay({}));
    await timed('late', () => reports.late({}));
    const alarms = await timed('alarms', () => reports.alarms({}));
    expect(alarms.summary.total).toBe(expected.alarms.total);
    const quality = await timed('quality', () => reports.quality({}));
    expect(quality.meta.total).toBe(expected.quality.total);
    await timed('summary', () => reports.summary());
    await timed('student detail', () =>
      reports.studentDetail(dataset.students[4]!.id, {}),
    );
    await timed('csv export', () => reports.exportCsv('attendance', {}));
  });
});
