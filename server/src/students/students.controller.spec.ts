import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { STUDENTS_REPOSITORY } from './domain/students.repository.js';
import { InMemoryStudentsRepository } from './infrastructure/in-memory-students.repository.js';
import { StudentsController } from './students.controller.js';
import { StudentsService } from './students.service.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import { auditTestProviders } from '../common/audit/testing.js';
import {
  TEST_ORIGIN,
  authTestProviders,
  panelHeaders,
  signInAs,
} from '../auth/testing.js';
import type { TestingModule } from '@nestjs/testing';

const KEY = 'admin-key-1234567890';
const body = { document: '100', name: 'Ana', consented: true };

describe('StudentsController (HTTP)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  const http = () => request(app.getHttpServer());
  const auth = { 'x-api-key': KEY };

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [StudentsController],
      providers: [
        ...authTestProviders({ corsOrigins: [TEST_ORIGIN] }),
        ...auditTestProviders,
        StudentsService,
        { provide: CLOCK, useValue: systemClock },
        { provide: STUDENTS_REPOSITORY, useClass: InMemoryStudentsRepository },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  it('requires the API key', async () => {
    await http().get('/students').expect(401);
    await http().post('/students').send(body).expect(401);
  });

  it('lets an assistant operate but only an admin deactivate (R16)', async () => {
    const assistant = await signInAs(moduleRef, 'ana', 'asistente');
    const admin = await signInAs(moduleRef, 'boss', 'admin');
    const created = await http()
      .post('/students')
      .set('Cookie', assistant)
      .set(panelHeaders())
      .send(body)
      .expect(201);
    await http().get('/students').set('Cookie', assistant).expect(200);
    await http()
      .patch(`/students/${created.body.id}`)
      .set('Cookie', assistant)
      .set(panelHeaders())
      .send({ name: 'Bea' })
      .expect(200);
    const denied = await http()
      .delete(`/students/${created.body.id}`)
      .set('Cookie', assistant)
      .set(panelHeaders())
      .expect(403);
    expect(denied.body.code).toBe('FORBIDDEN_ROLE');
    await http()
      .delete(`/students/${created.body.id}`)
      .set('Cookie', admin)
      .set(panelHeaders())
      .expect(200);
  });

  it('creates, rejects duplicates and validates the body', async () => {
    const created = await http()
      .post('/students')
      .set(auth)
      .send(body)
      .expect(201);
    expect(created.body).toMatchObject({ document: '100', active: true });
    await http().post('/students').set(auth).send(body).expect(409);
    await http().post('/students').set(auth).send({ name: 'x' }).expect(400);
  });

  it('lists, edits and deactivates', async () => {
    const { body: s } = await http().post('/students').set(auth).send(body);
    await http()
      .patch(`/students/${s.id}`)
      .set(auth)
      .send({ name: 'Bea' })
      .expect(200);
    await http().patch(`/students/${s.id}`).set(auth).send({}).expect(400);
    await http()
      .patch(`/students/${s.id}`)
      .set(auth)
      .send({ document: '9' })
      .expect(400);
    await http().delete(`/students/${s.id}`).set(auth).expect(200);
    const active = await http()
      .get('/students?active=true')
      .set(auth)
      .expect(200);
    expect(active.body).toHaveLength(0);
    const all = await http().get('/students').set(auth).expect(200);
    expect(all.body[0]).toMatchObject({ name: 'Bea', active: false });
  });

  it('answers 404 and 400 for unknown or malformed ids', async () => {
    await http()
      .delete(`/students/${crypto.randomUUID()}`)
      .set(auth)
      .expect(404);
    await http()
      .patch('/students/nope')
      .set(auth)
      .send({ name: 'x' })
      .expect(400);
  });

  it('returns the display name, generated or custom (R8)', async () => {
    const generated = await http()
      .post('/students')
      .set(auth)
      .send({ ...body, name: 'Ana María Gómez Pérez' })
      .expect(201);
    expect(generated.body.displayName).toBe('Ana M.');
    const edited = await http()
      .patch(`/students/${generated.body.id}`)
      .set(auth)
      .send({ displayName: 'Anita' })
      .expect(200);
    expect(edited.body.displayName).toBe('Anita');
    const tooLong = await http()
      .patch(`/students/${generated.body.id}`)
      .set(auth)
      .send({ displayName: 'x'.repeat(20) })
      .expect(400);
    expect(tooLong.body.message).toContain('máximo 16');
    await http()
      .post('/students')
      .set(auth)
      .send({ ...body, document: '101', displayName: 'y'.repeat(17) })
      .expect(400);
  });

  describe('contact data', () => {
    it('accepts, returns, lists and edits optional email and phone', async () => {
      const created = await http()
        .post('/students')
        .set(auth)
        .send({
          ...body,
          program: 'Ingenieria',
          email: ' Ana@UniCordoba.edu.co ',
          phone: '+57 (300) 123-4567',
        })
        .expect(201);
      expect(created.body).toMatchObject({
        program: 'Ingenieria',
        email: 'ana@unicordoba.edu.co',
        phone: '+57 (300) 123-4567',
      });
      const edited = await http()
        .patch(`/students/${created.body.id}`)
        .set(auth)
        .send({ email: 'otro@unicordoba.edu.co', phone: null })
        .expect(200);
      expect(edited.body).toMatchObject({
        email: 'otro@unicordoba.edu.co',
        phone: null,
      });
      const [listed] = (await http().get('/students').set(auth).expect(200))
        .body;
      expect(listed).toMatchObject({ email: 'otro@unicordoba.edu.co' });
    });

    it('defaults to null when omitted', async () => {
      const created = await http()
        .post('/students')
        .set(auth)
        .send(body)
        .expect(201);
      expect(created.body).toMatchObject({ email: null, phone: null });
    });

    it('rejects a malformed email or phone and over-long values', async () => {
      for (const extra of [
        { email: 'not-an-email' },
        { email: `${'a'.repeat(250)}@x.co` },
        { phone: 'call me' },
        { phone: '()' },
        { phone: '1'.repeat(21) },
        { phone: '' },
      ]) {
        await http()
          .post('/students')
          .set(auth)
          .send({ ...body, ...extra })
          .expect(400);
      }
      const { body: s } = await http().post('/students').set(auth).send(body);
      await http()
        .patch(`/students/${s.id}`)
        .set(auth)
        .send({ phone: 'abc' })
        .expect(400);
    });
  });
});
