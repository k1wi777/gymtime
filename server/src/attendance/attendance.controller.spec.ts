import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { buildAttendanceFixture } from './testing.js';

const KEY = 'admin-key-1234567890';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000099';
const bogota = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00-05:00`);

describe('AttendanceController (HTTP)', () => {
  let app: INestApplication;
  let fx: ReturnType<typeof buildAttendanceFixture>;
  const auth = { 'x-api-key': KEY };
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    fx = buildAttendanceFixture();
    const moduleRef = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        ApiKeyGuard,
        { provide: ConfigService, useValue: { get: () => KEY } },
        { provide: AttendanceService, useValue: fx.service },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  async function studentInSchedule() {
    const schedule = await fx.weekly('A', '10:00', '11:00');
    const ana = await fx.newStudent('1');
    await fx.schedules.assignStudent(schedule.schedule.id, ana.id);
    fx.setNow(bogota('10:30'));
    return ana;
  }

  it('requires the API key on every route', async () => {
    await http().get('/attendance/open').expect(401);
    await http().get('/attendance/sessions').expect(401);
    await http().post('/attendance/entry').send({}).expect(401);
    await http().post('/attendance/exit').send({}).expect(401);
  });

  it('lists open sessions with student and occurrence data', async () => {
    const ana = await studentInSchedule();
    await http()
      .post('/attendance/entry')
      .set(auth)
      .send({ studentId: ana.id, reason: 'olvidó la huella' })
      .expect(201);

    const open = await http().get('/attendance/open').set(auth).expect(200);
    expect(open.body).toHaveLength(1);
    expect(open.body[0]).toMatchObject({
      student: { id: ana.id, document: '1' },
      enteredAt: bogota('10:30').toISOString(),
      instance: { startsAt: bogota('10:00').toISOString() },
    });
    const listed = await http()
      .get('/attendance/sessions?status=abierta&limit=10')
      .set(auth)
      .expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({
      entrySource: 'manual',
      manualReason: 'olvidó la huella',
      status: 'abierta',
    });
  });

  it('registers an entry and an exit manually with the reason', async () => {
    const ana = await studentInSchedule();
    const entry = await http()
      .post('/attendance/entry')
      .set(auth)
      .send({ studentId: ana.id, reason: 'entrada manual' })
      .expect(201);
    expect(entry.body).toMatchObject({ entrySource: 'manual', status: 'abierta' });

    fx.setNow(bogota('10:40'));
    const exit = await http()
      .post('/attendance/exit')
      .set(auth)
      .send({ studentId: ana.id, reason: 'salida manual' })
      .expect(200);
    expect(exit.body).toMatchObject({
      status: 'cerrada',
      exitSource: 'manual',
      manualReason: 'salida manual',
    });
  });

  it('maps rule violations to 404 and 409 with the code', async () => {
    const ana = await studentInSchedule();
    await http()
      .post('/attendance/entry')
      .set(auth)
      .send({ studentId: UNKNOWN_ID, reason: 'x' })
      .expect(404);

    const second = await http()
      .post('/attendance/entry')
      .set(auth)
      .send({ studentId: ana.id, reason: 'primera' })
      .expect(201);
    expect(second.body.status).toBe('abierta');

    const conflict = await http()
      .post('/attendance/entry')
      .set(auth)
      .send({ studentId: ana.id, reason: 'repetida' })
      .expect(409);
    expect(conflict.body).toMatchObject({ code: 'SESSION_ALREADY_OPEN' });

    const other = await fx.newStudent('2');
    const noSession = await http()
      .post('/attendance/exit')
      .set(auth)
      .send({ studentId: other.id, reason: 'sin sesión' })
      .expect(409);
    expect(noSession.body).toMatchObject({ code: 'NO_OPEN_SESSION' });

    const withoutSchedule = await fx.newStudent('3');
    fx.setNow(bogota('12:00'));
    const denied = await http()
      .post('/attendance/entry')
      .set(auth)
      .send({ studentId: withoutSchedule.id, reason: 'sin horario' })
      .expect(409);
    expect(denied.body).toMatchObject({ code: 'NO_ACTIVE_SCHEDULE' });
  });

  it('answers 400 for invalid bodies and queries', async () => {
    await http()
      .post('/attendance/entry')
      .set(auth)
      .send({ studentId: UNKNOWN_ID })
      .expect(400);
    await http()
      .post('/attendance/entry')
      .set(auth)
      .send({ studentId: UNKNOWN_ID, reason: '   ' })
      .expect(400);
    await http()
      .post('/attendance/exit')
      .set(auth)
      .send({ studentId: 'not-a-uuid', reason: 'x' })
      .expect(400);
    await http()
      .get('/attendance/sessions?studentId=not-a-uuid')
      .set(auth)
      .expect(400);
    await http()
      .get('/attendance/sessions?status=abierta&limit=500')
      .set(auth)
      .expect(400);
  });
});
