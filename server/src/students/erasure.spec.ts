import { describe, expect, it } from 'vitest';
import {
  buildEnrollmentFixture,
  validTemplate,
} from '../fingerprints/testing.js';
import { SEMESTER_NOW, buildSemester } from '../reports/seed/semester.js';
import { buildReportsFixture } from '../reports/testing.js';
import { SchedulesDeactivationRegistrar } from '../schedules/schedules-deactivation.registrar.js';
import { ErasureConfirmationError } from './students.service.js';

/** Student with contact data, a stored template and an enrollment. */
async function enrolledStudent() {
  const fx = buildEnrollmentFixture();
  fx.students.onDeactivated((s) => fx.service.onStudentDeactivated(s));
  fx.students.onErased((s) => fx.service.onStudentErased(s));
  await fx.devices.markOnline('d1', '1.0.0');
  const student = await fx.students.create({
    document: '1001',
    name: 'Ana María Gómez',
    program: 'Ingeniería',
    email: 'ana@example.com',
    phone: '3001234567',
    consented: true,
  });
  const enrollment = await fx.service.start(student.id);
  await fx.service.handleDone('d1', enrollment.id, validTemplate());
  return { ...fx, student };
}

describe('StudentsService.erase (R10-R12, Ley 1581)', () => {
  it('anonymises every personal field, deactivates and deletes templates and enrollments', async () => {
    const fx = await enrolledStudent();
    expect(fx.fingerprints.all()).toHaveLength(1);

    const result = await fx.students.erase(fx.student.id, '1001');

    expect(result).toEqual({ studentId: fx.student.id, templatesDeleted: 1 });
    const after = (await fx.students.findById(fx.student.id))!;
    expect(after).toMatchObject({
      name: 'Estudiante anonimizado',
      document: `ANON-${fx.student.id.replaceAll('-', '').slice(0, 8)}`,
      displayName: 'Anonimizado',
      program: null,
      email: null,
      phone: null,
      active: false,
    });
    expect(after.anonymizedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(after)).not.toMatch(
      /Ana|1001|ingenier|example|3001234567/i,
    );
    expect(fx.fingerprints.all()).toHaveLength(0);
    expect(await fx.enrollments.findById(fx.student.id)).toBeNull();
  });

  it('keeps the consent record as evidence and gives each student a unique neutral document', async () => {
    const fx = await enrolledStudent();
    const other = await fx.students.create({
      document: '2002',
      name: 'Luis',
      program: null,
    });
    await fx.students.erase(fx.student.id, '1001');
    await fx.students.erase(other.id, '2002');
    const [a, b] = [
      await fx.students.findById(fx.student.id),
      await fx.students.findById(other.id),
    ];
    expect(a?.consentVersion).toBe('v1-provisional');
    expect(a?.document).not.toBe(b?.document);
  });

  it('audits id, actor and count only, with no personal data', async () => {
    const fx = await enrolledStudent();
    await fx.students.erase(fx.student.id, '1001');
    const erased = fx.eventLog.entries.filter(
      (e) => e.type === 'student.erased',
    );
    expect(erased).toHaveLength(1);
    expect(erased[0]?.detail).toEqual({
      studentId: fx.student.id,
      fingerprintsDeleted: 1,
    });
    expect(erased[0]?.actor).toBeDefined();
    expect(JSON.stringify(fx.eventLog.entries)).not.toMatch(
      /Ana|1001|Ingenier|example\.com|3001234567/,
    );
  });

  it('strips personal fields from earlier events of that student only', async () => {
    const fx = await enrolledStudent();
    const other = await fx.students.create({
      document: '2002',
      name: 'Luis',
      program: null,
    });
    for (const [id, name] of [
      [fx.student.id, 'Ana María'],
      [other.id, 'Luis'],
    ] as const) {
      await fx.eventLog.append({
        type: 'legacy.import',
        actor: { type: 'system', id: null },
        detail: {
          studentId: id,
          name,
          document: 'x',
          email: 'e@x',
          batch: 'b1',
        },
      });
    }
    await fx.students.erase(fx.student.id, '1001');
    const legacy = fx.eventLog.entries.filter(
      (e) => e.type === 'legacy.import',
    );
    expect(legacy[0]?.detail).toEqual({
      studentId: fx.student.id,
      batch: 'b1',
    });
    expect(legacy[1]?.detail).toMatchObject({ name: 'Luis', document: 'x' });
    const stored = fx.eventLog.stored.filter((e) => e.type === 'legacy.import');
    expect(stored[0]?.detail).toEqual({
      studentId: fx.student.id,
      batch: 'b1',
    });
  });

  it('is idempotent: repeating changes nothing and records no second erasure', async () => {
    const fx = await enrolledStudent();
    await fx.students.erase(fx.student.id, '1001');
    const first = (await fx.students.findById(fx.student.id))!;
    const again = await fx.students.erase(fx.student.id, first.document);
    expect(again).toEqual({ studentId: fx.student.id, templatesDeleted: 0 });
    expect(await fx.students.findById(fx.student.id)).toEqual(first);
    expect(
      fx.eventLog.entries.filter((e) => e.type === 'student.erased'),
    ).toHaveLength(1);
  });

  it('refuses a wrong confirmation without touching anything; reapply needs no document', async () => {
    const fx = await enrolledStudent();
    await expect(
      fx.students.erase(fx.student.id, 'wrong'),
    ).rejects.toBeInstanceOf(ErasureConfirmationError);
    expect((await fx.students.findById(fx.student.id))?.name).toBe(
      'Ana María Gómez',
    );
    expect(fx.fingerprints.all()).toHaveLength(1);
    await fx.students.erase(fx.student.id, null);
    expect((await fx.students.findById(fx.student.id))?.name).toBe(
      'Estudiante anonimizado',
    );
  });

  it('answers null for an unknown student', async () => {
    const fx = await enrolledStudent();
    expect(
      await fx.students.erase('00000000-0000-4000-8000-000000000000', null),
    ).toBeNull();
  });

  it('is retriable: when a cleanup fails the personal data is already gone and a retry finishes', async () => {
    const fx = buildEnrollmentFixture();
    let broken = true;
    fx.students.onErased(async (s) => {
      if (broken) throw new Error('disk full');
      return fx.service.onStudentErased(s);
    });
    const student = await fx.students.create({
      document: '1',
      name: 'Ana',
      program: null,
      consented: true,
    });
    await expect(fx.students.erase(student.id, '1')).rejects.toThrow(
      'disk full',
    );
    expect((await fx.students.findById(student.id))?.name).toBe(
      'Estudiante anonimizado',
    );
    broken = false;
    await expect(fx.students.erase(student.id, null)).resolves.toMatchObject({
      studentId: student.id,
    });
  });

  it('notifies the sync once everything is cleaned up (after the deletion)', async () => {
    const fx = await enrolledStudent();
    const seen: number[] = [];
    fx.students.afterErased(() => seen.push(fx.fingerprints.all().length));
    await fx.students.erase(fx.student.id, '1001');
    expect(seen).toEqual([0]);
  });

  it('keeps sessions and reports adding up, now under the anonymised name', async () => {
    const dataset = buildSemester();
    const fx = buildReportsFixture({ dataset });
    new SchedulesDeactivationRegistrar(
      fx.students,
      fx.schedules,
    ).onModuleInit();
    const target = dataset.students.find((s) => s.profile === 'regular')!;
    const sessionsOf = async () =>
      (await fx.reports.attendanceReport({ studentId: target.id })).rows[0] as {
        group: string;
        obligations: number;
        attended: number;
      };
    const before = await sessionsOf();
    const totals = async () =>
      (await fx.reports.attendanceReport({})).meta as {
        obligations: number;
        attended: number;
      };
    const allBefore = await totals();

    fx.setNow(SEMESTER_NOW);
    await fx.students.erase(target.id, target.document);

    const after = await sessionsOf();
    expect(after.group).toBe('Estudiante anonimizado');
    expect(after.obligations).toBe(before.obligations);
    expect(after.attended).toBe(before.attended);
    expect(await totals()).toMatchObject(allBefore);
  });
});
