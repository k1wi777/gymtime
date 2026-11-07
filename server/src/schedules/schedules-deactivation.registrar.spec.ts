import { describe, expect, it } from 'vitest';
import {
  MID_SEMESTER_NOW,
  SEMESTER_NOW,
  buildSemester,
} from '../reports/seed/semester.js';
import { buildReportsFixture } from '../reports/testing.js';
import { SchedulesDeactivationRegistrar } from './schedules-deactivation.registrar.js';
import { buildSchedulesFixture } from './testing.js';

describe('SchedulesDeactivationRegistrar (H10 defect)', () => {
  it('closes every open interval when the student is deactivated', async () => {
    const fx = buildSchedulesFixture();
    new SchedulesDeactivationRegistrar(
      fx.students,
      fx.schedules,
    ).onModuleInit();
    const student = await fx.newStudent();
    const { schedule: a } = await fx.weekly('A', '10:00', '11:00');
    const { schedule: b } = await fx.weekly('B', '12:00', '13:00');
    await fx.schedules.assignStudent(a.id, student.id);
    await fx.schedules.assignStudent(b.id, student.id);
    fx.setNow(new Date('2026-11-03T15:00:00Z'));

    await fx.students.deactivate(student.id);

    for (const s of [a, b]) {
      const [interval] = await fx.schedules.listAssignments(s.id);
      expect(interval?.validTo).toEqual(new Date('2026-11-03T15:00:00Z'));
    }
  });

  it('is idempotent: repeating keeps the first closing instant', async () => {
    const fx = buildSchedulesFixture();
    new SchedulesDeactivationRegistrar(
      fx.students,
      fx.schedules,
    ).onModuleInit();
    const student = await fx.newStudent();
    const { schedule: a } = await fx.weekly('A', '10:00', '11:00');
    await fx.schedules.assignStudent(a.id, student.id);
    fx.setNow(new Date('2026-11-03T15:00:00Z'));
    await fx.students.deactivate(student.id);
    fx.setNow(new Date('2026-11-09T15:00:00Z'));
    await fx.students.deactivate(student.id);
    const [interval] = await fx.schedules.listAssignments(a.id);
    expect(interval?.validTo).toEqual(new Date('2026-11-03T15:00:00Z'));
  });

  it('retries the cleanup when it failed the first time', async () => {
    const fx = buildSchedulesFixture();
    const student = await fx.newStudent();
    const { schedule: a } = await fx.weekly('A', '10:00', '11:00');
    await fx.schedules.assignStudent(a.id, student.id);
    await fx.students.deactivate(student.id); // no registrar yet: cleanup "failed"
    expect((await fx.schedules.listAssignments(a.id))[0]?.validTo).toBeNull();
    new SchedulesDeactivationRegistrar(
      fx.students,
      fx.schedules,
    ).onModuleInit();
    await fx.students.deactivate(student.id);
    expect(
      (await fx.schedules.listAssignments(a.id))[0]?.validTo,
    ).not.toBeNull();
  });

  it('the next occurrences no longer count absences in the reports', async () => {
    const dataset = buildSemester();
    const fx = buildReportsFixture({ dataset });
    new SchedulesDeactivationRegistrar(
      fx.students,
      fx.schedules,
    ).onModuleInit();
    const target = dataset.students.find((s) => s.profile === 'regular')!;
    const rowOf = async () =>
      (await fx.reports.attendanceReport({})).rows.find(
        (r) => r.group === target.name,
      ) as { obligations: number; absences: number };
    const before = await rowOf();

    fx.setNow(MID_SEMESTER_NOW);
    await fx.students.deactivate(target.id);
    fx.setNow(SEMESTER_NOW);
    const after = await rowOf();

    expect(after.obligations).toBeLessThan(before.obligations);
    expect(after.absences).toBeLessThan(before.absences);
  });
});
