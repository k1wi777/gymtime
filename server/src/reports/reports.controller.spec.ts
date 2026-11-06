import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { authTestProviders, signInAs } from '../auth/testing.js';
import { SYSTEM_ACTOR, runAsActor } from '../common/audit/actor.js';
import { ReportsController } from './reports.controller.js';
import { ReportTooLargeError, ReportsService } from './reports.service.js';
import { buildSemester } from './seed/semester.js';
import { buildReportsFixture } from './testing.js';

const KEY = 'admin-key-1234567890';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const dataset = buildSemester();

describe('ReportsController (HTTP)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let fixture: ReturnType<typeof buildReportsFixture>;
  const http = () => request(app.getHttpServer());
  const auth = { 'x-api-key': KEY };

  beforeEach(async () => {
    fixture = buildReportsFixture({ dataset });
    moduleRef = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        ...authTestProviders(),
        { provide: ReportsService, useValue: fixture.reports },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.use((_req: unknown, _res: unknown, next: () => void) =>
      runAsActor(SYSTEM_ACTOR, next),
    );
    await app.init();
  });

  afterEach(() => app.close());

  it('requires a credential, and an assistant gets 403 on every route (R13)', async () => {
    const assistant = await signInAs(moduleRef, 'ana', 'asistente');
    const routes = [
      '/reports/options',
      '/reports/summary',
      '/reports/flow',
      '/reports/attendance',
      '/reports/stay',
      '/reports/late',
      '/reports/alarms',
      '/reports/quality',
      `/reports/students/${UNKNOWN_ID}`,
      '/reports/flow/export',
    ];
    for (const route of routes) {
      await http().get(route).expect(401);
      await http().get(route).set('Cookie', assistant).expect(403);
    }
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    await http().get('/reports/flow').set('Cookie', admin).expect(200);
  });

  it('answers the JSON with columns, rows, meta and the filters applied', async () => {
    const res = await http()
      .get('/reports/attendance?groupBy=schedule&sort=obligations&dir=desc')
      .set(auth)
      .expect(200);
    expect(res.body.filters).toEqual({ from: '2026-02-02', to: '2026-05-29' });
    expect(res.body.columns.map((c: { key: string }) => c.key)).toEqual([
      'group',
      'obligations',
      'attended',
      'absences',
      'compliance',
    ]);
    const obligations = res.body.rows.map(
      (r: { obligations: number }) => r.obligations,
    );
    expect(obligations).toEqual([...obligations].sort((a, b) => b - a));
  });

  it.each([
    ['/reports/flow?from=2026-03-02&to=2026-03-01', 'INVALID_RANGE'],
    ['/reports/flow?from=2025-01-01&to=2026-01-02', 'RANGE_TOO_WIDE'],
  ])('rejects the range of %s with 400', async (url, code) => {
    const res = await http().get(url).set(auth).expect(400);
    expect(res.body.code).toBe(code);
  });

  it('rejects filters that do not apply: alarms by student, an unknown key, a bad id', async () => {
    await http()
      .get(`/reports/alarms?studentId=${UNKNOWN_ID}`)
      .set(auth)
      .expect(400);
    await http().get('/reports/alarms?program=X').set(auth).expect(400);
    await http().get('/reports/flow?from=2026-02-30').set(auth).expect(400);
    await http().get('/reports/flow?nope=1').set(auth).expect(400);
    await http().get('/reports/flow?scheduleId=abc').set(auth).expect(400);
    await http().get('/reports/late?groupBy=month').set(auth).expect(400);
    await http().get('/reports/nope/export').set(auth).expect(400);
  });

  it('returns 404 for the detail of an unknown student', async () => {
    await http().get(`/reports/students/${UNKNOWN_ID}`).set(auth).expect(404);
    await http()
      .get(`/reports/students/${dataset.students[0]!.id}`)
      .set(auth)
      .expect(200);
  });

  it('exports a CSV equal to the JSON (columns, rows, order) and audits it first', async () => {
    const query =
      'groupBy=student&program=Enfermer%C3%ADa&sort=compliance&dir=desc';
    const json = await http()
      .get(`/reports/attendance?${query}`)
      .set(auth)
      .expect(200);
    const res = await http()
      .get(`/reports/attendance/export?${query}`)
      .set(auth)
      .expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="reporte-attendance-2026-02-02_2026-05-29.csv"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const text = res.text;
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(json.body.rows.length + 1);
    expect(lines[0]!.split(';')).toEqual(
      json.body.columns.map((c: { label: string }) => c.label),
    );
    json.body.rows.forEach(
      (row: { group: string; obligations: number }, i: number) => {
        const cells = lines[i + 1]!.split(';');
        expect(cells[0]).toBe(row.group);
        expect(cells[2]).toBe(String(row.obligations));
      },
    );

    const [event] = await fixture.eventLogRepo.search({
      typePrefix: 'report.',
      limit: 5,
    });
    expect(event).toMatchObject({
      type: 'report.exported',
      actor: { type: 'system' },
      detail: {
        report: 'attendance',
        from: '2026-02-02',
        to: '2026-05-29',
        program: 'Enfermería',
        sort: 'compliance',
        dir: 'desc',
        rows: json.body.rows.length,
      },
    });
    // No personal data: no name or document of anybody in the event.
    const stored = JSON.stringify(event);
    expect(stored).not.toMatch(/SIM-\d|Pérez|Gómez/);
  });

  it('records the signed-in administrator as the actor of the export', async () => {
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    await http()
      .get('/reports/quality/export')
      .set('Cookie', admin)
      .expect(200);
    const [event] = await fixture.eventLogRepo.search({
      typePrefix: 'report.',
      limit: 1,
    });
    expect(event!.actor.type).toBe('user');
  });

  it('delivers no file when the audit record fails', async () => {
    const failing = vi
      .spyOn(fixture.eventLogService, 'recordOrThrow')
      .mockRejectedValue(new Error('db down'));
    const res = await http().get('/reports/flow/export').set(auth).expect(500);
    expect(res.text).not.toContain('Agrupación');
    expect(failing).toHaveBeenCalledOnce();
  });

  it('answers 422 REPORT_TOO_LARGE when the table would be too big', async () => {
    vi.spyOn(fixture.reports, 'exportCsv').mockRejectedValue(
      new ReportTooLargeError(),
    );
    const res = await http().get('/reports/stay/export').set(auth).expect(422);
    expect(res.body.code).toBe('REPORT_TOO_LARGE');
  });

  it('offers the programs, schedules, active period and default range', async () => {
    const res = await http().get('/reports/options').set(auth).expect(200);
    expect(res.body.programs).toEqual([
      'Enfermería',
      'Ingeniería de Sistemas',
      'Medicina Veterinaria',
    ]);
    expect(res.body.schedules).toHaveLength(6);
    expect(res.body.period.name).toBe('Simulación 2026-1 (semilla)');
    expect(res.body.defaultRange).toEqual({
      from: '2026-02-02',
      to: '2026-05-29',
    });
  });
});
