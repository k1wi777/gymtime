import {
  ScheduleOverlapError,
  ScheduleValidationError,
} from './domain/schedule.js';
import { buildSchedulesFixture } from './testing.js';

async function setup() {
  const f = buildSchedulesFixture();
  const { period } = await f.periods.create({
    name: '2026-2',
    startDate: '2026-11-02',
    endDate: '2026-11-30',
  });
  const recurring = (
    weekday: number,
    start: string,
    end: string,
    periodId = period.id,
  ) =>
    f.schedules.create({
      name: `${weekday} ${start}`,
      weekday,
      start,
      end,
      periodId,
    });
  return { f, period, recurring };
}

describe('Overlap of schedules of a period (E19-1)', () => {
  it('rejects an overlapping schedule of the same period and day, naming it', async () => {
    const { recurring } = await setup();
    await recurring(1, '10:00', '11:00');
    const error = await recurring(1, '10:30', '11:30').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScheduleOverlapError);
    expect((error as Error).message).toContain('1 10:00');
  });

  it('allows adjacent schedules, other days and other periods', async () => {
    const { f, recurring } = await setup();
    await recurring(1, '10:00', '11:00');
    await recurring(1, '11:00', '12:00');
    await recurring(1, '09:00', '10:00');
    await recurring(2, '10:00', '11:00');
    const other = await f.periods.create({
      name: 'otro',
      startDate: '2027-01-01',
      endDate: '2027-01-31',
    });
    await recurring(1, '10:00', '11:00', other.period.id);
  });

  it('checks an edit against the others but not against itself', async () => {
    const { f, recurring } = await setup();
    const a = await recurring(1, '10:00', '11:00');
    await recurring(1, '12:00', '13:00');
    await f.schedules.update(a.schedule.id, { end: '11:30' });
    await expect(
      f.schedules.update(a.schedule.id, { end: '12:30' }),
    ).rejects.toBeInstanceOf(ScheduleOverlapError);
  });

  it('rejects an unknown period and a one-off schedule with a period', async () => {
    const { f, period } = await setup();
    await expect(
      f.schedules.create({
        name: 'x',
        weekday: 1,
        start: '10:00',
        end: '11:00',
        periodId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'PERIOD_NOT_FOUND' });
    await expect(
      f.schedules.create({
        name: 'x',
        date: '2026-11-09',
        start: '10:00',
        end: '11:00',
        periodId: period.id,
      }),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
  });
});

describe('Assignment with validity (E19-2)', () => {
  it('starts later when asked and never in the past', async () => {
    const { f, recurring } = await setup();
    const { schedule } = await recurring(1, '10:00', '11:00');
    const ana = await f.newStudent('1');
    const later = new Date('2026-11-09T05:00:00Z');
    await f.schedules.assignStudent(schedule.id, ana.id, later);
    const [row] = await f.schedulesRepo.listAssignments(schedule.id);
    expect(row?.validFrom).toEqual(later);
    // Not assigned yet today.
    expect((await f.schedules.get(schedule.id))?.students).toEqual([]);
    await expect(
      f.schedules.assignStudent(
        schedule.id,
        ana.id,
        new Date('2026-10-01T00:00:00Z'),
      ),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it('removing a student closes the validity and leaves the past roster intact', async () => {
    const { f, recurring } = await setup();
    const { schedule } = await recurring(1, '10:00', '11:00');
    const ana = await f.newStudent('1');
    await f.schedules.assignStudent(schedule.id, ana.id);
    f.setNow(new Date('2026-11-09T12:00:00Z'));
    await f.schedules.unassignStudent(schedule.id, ana.id);
    const [row] = await f.schedulesRepo.listAssignments(schedule.id);
    expect(row?.validTo).toEqual(new Date('2026-11-09T12:00:00Z'));
    // At the Nov 2 occurrence she still counts as assigned.
    const at = new Date('2026-11-02T15:30:00Z');
    expect(
      (await f.schedulesRepo.listStudentIds([schedule.id], at)).get(
        schedule.id,
      ),
    ).toEqual([ana.id]);
    expect((await f.schedules.get(schedule.id))?.students).toEqual([]);
  });
});

describe('Bulk assignment by documents (E19-3)', () => {
  it('assigns the active ones and reports the rest apart without aborting', async () => {
    const { f, recurring } = await setup();
    const { schedule } = await recurring(1, '10:00', '11:00');
    const ana = await f.newStudent('1');
    const luis = await f.newStudent('2');
    const eva = await f.newStudent('3');
    const old = await f.newStudent('4');
    await f.students.deactivate(old.id);
    await f.schedules.assignStudent(schedule.id, luis.id);
    const result = await f.schedules.bulkAssign(schedule.id, [
      ' 1 ',
      '2',
      '3',
      '4',
      '999',
      '1',
      '',
    ]);
    expect(result.assigned.map((s) => s.id).sort()).toEqual(
      [ana.id, eva.id].sort(),
    );
    expect(result.alreadyAssigned.map((s) => s.id)).toEqual([luis.id]);
    expect(result.inactive.map((s) => s.id)).toEqual([old.id]);
    expect(result.notFound).toEqual(['999']);
    const detail = await f.schedules.get(schedule.id);
    expect(detail?.students).toHaveLength(3);
  });

  it('audits one event with counts and no documents', async () => {
    const { f, recurring } = await setup();
    const { schedule } = await recurring(1, '10:00', '11:00');
    await f.newStudent('1234567');
    await f.schedules.bulkAssign(schedule.id, ['1234567', '7654321']);
    const events = f.eventLogRepo.entries.filter(
      (e) => e.type === 'schedule.students_bulk_assigned',
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({
      scheduleId: schedule.id,
      assigned: 1,
      alreadyAssigned: 0,
      inactive: 0,
      notFound: 1,
    });
    expect(JSON.stringify(f.eventLogRepo.entries)).not.toMatch(
      /1234567|7654321/,
    );
  });

  it('reports a missing schedule', async () => {
    const f = buildSchedulesFixture();
    await expect(
      f.schedules.bulkAssign('00000000-0000-4000-8000-000000000000', ['1']),
    ).rejects.toMatchObject({ code: 'SCHEDULE_NOT_FOUND' });
  });
});

describe('Copy of a listing (E19-4)', () => {
  it('copies only active students without duplicating the ones already there', async () => {
    const { f, recurring } = await setup();
    const from = await recurring(1, '10:00', '11:00');
    const to = await recurring(3, '10:00', '11:00');
    const [a, b, c] = await Promise.all(
      ['1', '2', '3'].map((d) => f.newStudent(d)),
    );
    for (const s of [a, b, c]) {
      await f.schedules.assignStudent(from.schedule.id, s!.id);
    }
    await f.students.deactivate(c!.id);
    await f.schedules.assignStudent(to.schedule.id, a!.id);
    const result = await f.schedules.copyStudents(
      to.schedule.id,
      from.schedule.id,
    );
    expect(result).toEqual({
      assigned: 1,
      alreadyAssigned: 1,
      skippedInactive: 1,
    });
    const students = (await f.schedules.get(to.schedule.id))?.students ?? [];
    expect(students.map((s) => s.id).sort()).toEqual([a!.id, b!.id].sort());
  });

  it('refuses to copy a schedule onto itself', async () => {
    const { f, recurring } = await setup();
    const { schedule } = await recurring(1, '10:00', '11:00');
    await expect(
      f.schedules.copyStudents(schedule.id, schedule.id),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
  });
});
