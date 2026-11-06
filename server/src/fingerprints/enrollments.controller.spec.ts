import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { authTestProviders } from '../auth/testing.js';
import { EnrollmentService } from './enrollment.service.js';
import { EnrollmentsController } from './enrollments.controller.js';
import { buildEnrollmentFixture } from './testing.js';

const KEY = 'admin-key-1234567890';

describe('EnrollmentsController (HTTP)', () => {
  let app: INestApplication;
  let fx: ReturnType<typeof buildEnrollmentFixture>;
  const auth = { 'x-api-key': KEY };
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    fx = buildEnrollmentFixture();
    await fx.devices.markOnline('d1', '1.0.0');
    const moduleRef = await Test.createTestingModule({
      controllers: [EnrollmentsController],
      providers: [
        ...authTestProviders(),
        {
          provide: EnrollmentService,
          useValue: fx.service,
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  it('requires the API key', async () => {
    const id = crypto.randomUUID();
    await http().post(`/students/${id}/enrollments`).expect(401);
    await http().post(`/enrollments/${id}/cancel`).expect(401);
    await http().get(`/enrollments/${id}`).expect(401);
  });

  it('starts, queries and cancels an enrollment without leaking templates', async () => {
    const student = await fx.newStudent();
    const started = await http()
      .post(`/students/${student.id}/enrollments`)
      .set(auth)
      .expect(201);
    expect(started.body).toMatchObject({
      status: 'in_progress',
      studentId: student.id,
      deviceId: 'd1',
    });
    expect(Object.keys(started.body)).not.toContain('template');
    const queried = await http()
      .get(`/enrollments/${started.body.id}`)
      .set(auth)
      .expect(200);
    expect(queried.body.id).toBe(started.body.id);
    await http()
      .post(`/enrollments/${started.body.id}/cancel`)
      .set(auth)
      .expect(200);
    await http()
      .post(`/enrollments/${started.body.id}/cancel`)
      .set(auth)
      .expect(409);
  });

  it('maps rule violations to 404 and 409', async () => {
    const student = await fx.newStudent();
    await http()
      .post(`/students/${crypto.randomUUID()}/enrollments`)
      .set(auth)
      .expect(404);
    await http()
      .post(`/students/${student.id}/enrollments`)
      .set(auth)
      .expect(201);
    const other = await fx.newStudent('200');
    await http()
      .post(`/students/${other.id}/enrollments`)
      .set(auth)
      .expect(409);
    await fx.students.deactivate(other.id);
    await http()
      .post(`/students/${other.id}/enrollments`)
      .set(auth)
      .expect(409);
    await http()
      .get(`/enrollments/${crypto.randomUUID()}`)
      .set(auth)
      .expect(404);
    await http()
      .post(`/enrollments/${crypto.randomUUID()}/cancel`)
      .set(auth)
      .expect(404);
  });

  it('answers 409 when the device does not ack and 400 for bad input', async () => {
    fx.setSendResult('failed');
    const student = await fx.newStudent();
    await http()
      .post(`/students/${student.id}/enrollments`)
      .set(auth)
      .expect(409);
    await http().get('/enrollments/not-a-uuid').set(auth).expect(400);
    await http()
      .post(`/students/${student.id}/enrollments`)
      .set(auth)
      .send({ deviceId: 5 })
      .expect(400);
  });

  it('accepts an explicit deviceId', async () => {
    const student = await fx.newStudent();
    const res = await http()
      .post(`/students/${student.id}/enrollments`)
      .set(auth)
      .send({ deviceId: 'd7' })
      .expect(201);
    expect(res.body.deviceId).toBe('d7');
  });
});
