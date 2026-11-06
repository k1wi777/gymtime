import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { auditTestProviders } from '../common/audit/testing.js';
import {
  TEST_ORIGIN,
  authTestProviders,
  panelHeaders,
  signInAs,
} from '../auth/testing.js';
import type { TestingModule } from '@nestjs/testing';
import { CLOCK } from '../common/time/clock.js';
import { STUDENTS_REPOSITORY } from '../students/domain/students.repository.js';
import { InMemoryStudentsRepository } from '../students/infrastructure/in-memory-students.repository.js';
import { StudentsService } from '../students/students.service.js';
import { INSTANCES_REPOSITORY } from './domain/instances.repository.js';
import { SCHEDULES_REPOSITORY } from './domain/schedules.repository.js';
import { InMemoryInstancesRepository } from './infrastructure/in-memory-instances.repository.js';
import { InMemorySchedulesRepository } from './infrastructure/in-memory-schedules.repository.js';
import { InstancesService } from './instances.service.js';
import { SCHEDULES_CONFIG } from './schedules.config.js';
import { PERIODS_REPOSITORY } from './periods/periods.repository.js';
import { InMemoryPeriodsRepository } from './periods/in-memory-periods.repository.js';
import { SchedulesController } from './schedules.controller.js';
import { SchedulesService } from './schedules.service.js';
import { MONDAY_9AM_BOGOTA, testSchedulesConfig } from './testing.js';

const KEY = 'admin-key-1234567890';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('SchedulesController (HTTP)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  const http = () => request(app.getHttpServer());
  const auth = { 'x-api-key': KEY };

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [SchedulesController],
      providers: [
        ...authTestProviders({ corsOrigins: [TEST_ORIGIN] }),
        ...auditTestProviders,
        SchedulesService,
        InstancesService,
        StudentsService,
        { provide: CLOCK, useValue: { now: () => MONDAY_9AM_BOGOTA } },
        { provide: SCHEDULES_CONFIG, useValue: testSchedulesConfig },
        { provide: PERIODS_REPOSITORY, useClass: InMemoryPeriodsRepository },
        { provide: STUDENTS_REPOSITORY, useClass: InMemoryStudentsRepository },
        {
          provide: SCHEDULES_REPOSITORY,
          useClass: InMemorySchedulesRepository,
        },
        {
          provide: INSTANCES_REPOSITORY,
          useClass: InMemoryInstancesRepository,
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const period = await moduleRef.get(PERIODS_REPOSITORY).create({
      name: '2026-2',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    });
    weekly = {
      name: 'Morning',
      weekday: 1,
      start: '10:00',
      end: '11:00',
      periodId: period.id,
    };
  });

  afterEach(() => app.close());

  let weekly: {
    name: string;
    weekday: number;
    start: string;
    end: string;
    periodId: string;
  };

  it('requires the API key on every route', async () => {
    await http().get('/schedules').expect(401);
    await http().post('/schedules').send(weekly).expect(401);
    await http().get('/schedules/resolve').expect(401);
    await http()
      .put(`/schedules/${UNKNOWN_ID}/students/${UNKNOWN_ID}`)
      .expect(401);
  });

  it('lets an assistant read but only an admin create and assign (R16)', async () => {
    const assistant = await signInAs(moduleRef, 'ana', 'asistente');
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    const write = (cookie: string) => ({ cookie, headers: panelHeaders() });
    const as = write(assistant);
    await http().get('/schedules').set('Cookie', assistant).expect(200);
    await http()
      .post('/schedules')
      .set('Cookie', as.cookie)
      .set(as.headers)
      .send(weekly)
      .expect(403);
    await http()
      .put(`/schedules/${UNKNOWN_ID}/students/${UNKNOWN_ID}`)
      .set('Cookie', as.cookie)
      .set(as.headers)
      .expect(403);
    await http()
      .delete(`/schedules/${UNKNOWN_ID}/students/${UNKNOWN_ID}`)
      .set('Cookie', as.cookie)
      .set(as.headers)
      .expect(403);
    await http()
      .post('/schedules')
      .set('Cookie', admin)
      .set(panelHeaders())
      .send(weekly)
      .expect(201);
  });

  it('creates, lists and shows a schedule', async () => {
    const created = await http()
      .post('/schedules')
      .set(auth)
      .send(weekly)
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Morning',
      weekday: 1,
      startTime: '10:00:00',
      students: [],
    });
    expect(created.body.upcoming).toHaveLength(1);
    // Every Monday of the period, not only the horizon.
    expect(created.body.regeneration).toMatchObject({ created: 5 });
    const list = await http().get('/schedules').set(auth).expect(200);
    expect(list.body).toHaveLength(1);
    await http().get(`/schedules/${created.body.id}`).set(auth).expect(200);
    await http().get(`/schedules/${UNKNOWN_ID}`).set(auth).expect(404);
    await http().get('/schedules/not-a-uuid').set(auth).expect(400);
  });

  it('creates a quick schedule from endsInMinutes', async () => {
    const created = await http()
      .post('/schedules')
      .set(auth)
      .send({ name: 'Test', endsInMinutes: 3 })
      .expect(201);
    expect(created.body).toMatchObject({
      date: '2026-11-02',
      startTime: '09:00:00',
      endTime: '09:03:00',
    });
  });

  const valid = {
    name: 'Morning',
    weekday: 1,
    start: '10:00',
    end: '11:00',
    periodId: UNKNOWN_ID,
  };

  it.each([
    ['neither weekday nor date', { name: 'x', start: '10:00', end: '11:00' }],
    ['end before start', { ...valid, start: '11:00', end: '10:00' }],
    ['bad time format', { ...valid, start: '25:00' }],
    [
      'a recurring schedule without a period',
      { name: 'x', weekday: 1, start: '10:00', end: '11:00' },
    ],
    [
      'a one-off schedule with a period',
      {
        name: 'x',
        date: '2026-11-09',
        start: '10:00',
        end: '11:00',
        periodId: UNKNOWN_ID,
      },
    ],
    ['missing start and end', { name: 'x', weekday: 1 }],
    [
      'endsInMinutes mixed with a definition',
      { name: 'x', weekday: 1, endsInMinutes: 3 },
    ],
    ['unknown field', { ...valid, extra: 1 }],
  ])('rejects %s with 400', async (_label, body) => {
    await http().post('/schedules').set(auth).send(body).expect(400);
  });

  it('assigns and removes students, answering 404 for unknown ones', async () => {
    const schedule = (await http().post('/schedules').set(auth).send(weekly))
      .body;
    const students = app.get(StudentsService);
    const ana = await students.create({
      document: '1',
      name: 'Ana',
      program: null,
      consented: true,
    });

    await http()
      .put(`/schedules/${schedule.id}/students/${ana.id}`)
      .set(auth)
      .expect(204);
    await http()
      .put(`/schedules/${schedule.id}/students/${ana.id}`)
      .set(auth)
      .expect(204);
    const shown = await http().get(`/schedules/${schedule.id}`).set(auth);
    expect(shown.body.students).toEqual([
      { id: ana.id, document: '1', name: 'Ana', active: true },
    ]);
    await http()
      .put(`/schedules/${schedule.id}/students/${UNKNOWN_ID}`)
      .set(auth)
      .expect(404);
    await http()
      .put(`/schedules/${UNKNOWN_ID}/students/${ana.id}`)
      .set(auth)
      .expect(404);
    await http()
      .delete(`/schedules/${schedule.id}/students/${ana.id}`)
      .set(auth)
      .expect(204);
    await http()
      .delete(`/schedules/${schedule.id}/students/${ana.id}`)
      .set(auth)
      .expect(204);
    const after = await http().get(`/schedules/${schedule.id}`).set(auth);
    expect(after.body.students).toEqual([]);
  });

  it('resolves the schedule of a student at an instant', async () => {
    const schedule = (await http().post('/schedules').set(auth).send(weekly))
      .body;
    const ana = await app
      .get(StudentsService)
      .create({ document: '1', name: 'Ana', program: null, consented: true });
    await http()
      .put(`/schedules/${schedule.id}/students/${ana.id}`)
      .set(auth)
      .expect(204);

    const hit = await http()
      .get('/schedules/resolve')
      .query({ studentId: ana.id, at: '2026-11-02T10:30:00-05:00' })
      .set(auth)
      .expect(200);
    expect(hit.body.occurrence).toMatchObject({
      scheduleId: schedule.id,
      entryOpen: true,
      entryOpensAt: '2026-11-02T14:50:00.000Z',
    });
    const miss = await http()
      .get('/schedules/resolve')
      .query({ studentId: ana.id })
      .set(auth)
      .expect(200);
    expect(miss.body).toEqual({ occurrence: null });
    await http()
      .get('/schedules/resolve')
      .query({ studentId: 'x' })
      .set(auth)
      .expect(400);
  });
});
