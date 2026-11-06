import { ScheduleValidationError } from './domain/schedule.js';
import { ScheduleLookupFailed } from './schedules.service.js';
import { buildSchedulesFixture } from './testing.js';

describe('SchedulesService.create (R1, R2)', () => {
  it('creates a weekly schedule and generates its occurrences', async () => {
    const f = buildSchedulesFixture();
    const { schedule, upcoming } = await f.weekly('Morning', '10:00', '11:00');
    expect(schedule).toMatchObject({
      weekday: 1,
      date: null,
      startTime: '10:00:00',
      endTime: '11:00:00',
    });
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].startsAt.toISOString()).toBe('2026-11-02T15:00:00.000Z');
  });

  it('creates a one-off schedule', async () => {
    const f = buildSchedulesFixture();
    const { schedule, upcoming } = await f.schedules.create({
      name: 'Special',
      date: '2026-11-03',
      start: '08:00:30',
      end: '09:00',
    });
    expect(schedule).toMatchObject({ weekday: null, date: '2026-11-03' });
    expect(upcoming.map((i) => i.date)).toEqual(['2026-11-03']);
  });

  it.each([
    ['neither weekday nor date', { start: '10:00', end: '11:00' }],
    [
      'both weekday and date',
      { weekday: 1, date: '2026-11-02', start: '10:00', end: '11:00' },
    ],
    ['end equal to start', { weekday: 1, start: '10:00', end: '10:00' }],
    ['end before start', { weekday: 1, start: '11:00', end: '10:00' }],
    ['weekday 8', { weekday: 8, start: '10:00', end: '11:00' }],
    [
      'a margin over the limit',
      { weekday: 1, start: '10:00', end: '11:00', entryOpenMinutes: 241 },
    ],
  ])('rejects %s', async (_label, input) => {
    const f = buildSchedulesFixture();
    await expect(
      f.schedules.create({ name: 'Bad', ...input }),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
    expect(await f.schedules.list()).toEqual([]);
  });

  it('creates a quick schedule that starts now and ends in N minutes', async () => {
    const f = buildSchedulesFixture(new Date('2026-11-02T14:00:07.500Z'));
    const { schedule, upcoming } = await f.schedules.create({
      name: 'Test',
      endsInMinutes: 3,
    });
    expect(schedule).toMatchObject({
      date: '2026-11-02',
      startTime: '09:00:07',
      endTime: '09:03:07',
      entryCloseMinutes: 0,
    });
    expect(upcoming[0].endsAt.getTime() - upcoming[0].startsAt.getTime()).toBe(
      180_000,
    );
  });

  it('rejects a quick schedule that would cross midnight', async () => {
    const f = buildSchedulesFixture(new Date('2026-11-03T04:59:00Z'));
    await expect(
      f.schedules.create({ name: 'Test', endsInMinutes: 3 }),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
  });
});

describe('SchedulesService students and queries (R3, R4)', () => {
  it('assigns and removes students idempotently', async () => {
    const f = buildSchedulesFixture();
    const { schedule } = await f.weekly('Morning', '10:00', '11:00');
    const ana = await f.newStudent('1');
    await f.schedules.assignStudent(schedule.id, ana.id);
    await f.schedules.assignStudent(schedule.id, ana.id);
    expect((await f.schedules.get(schedule.id))?.students).toEqual([ana]);
    await f.schedules.unassignStudent(schedule.id, ana.id);
    await f.schedules.unassignStudent(schedule.id, ana.id);
    expect((await f.schedules.get(schedule.id))?.students).toEqual([]);
  });

  it('closes the validity instead of deleting and opens another on reassign (R15, R16, R18)', async () => {
    const f = buildSchedulesFixture(); // Monday 09:00 Bogota
    const { schedule } = await f.weekly('Morning', '10:00', '11:00');
    const ana = await f.newStudent('1');
    await f.schedules.assignStudent(schedule.id, ana.id);
    await f.schedules.assignStudent(schedule.id, ana.id);
    f.setNow(new Date('2026-11-02T15:00:00Z'));
    await f.schedules.unassignStudent(schedule.id, ana.id);
    await f.schedules.unassignStudent(schedule.id, ana.id);
    f.setNow(new Date('2026-11-02T16:00:00Z'));
    await f.schedules.assignStudent(schedule.id, ana.id);

    const history = await f.schedules.listAssignments(schedule.id);
    expect(history.map((a) => [a.validFrom.toISOString(), a.validTo])).toEqual([
      ['2026-11-02T14:00:00.000Z', new Date('2026-11-02T15:00:00Z')],
      ['2026-11-02T16:00:00.000Z', null],
    ]);
    expect((await f.schedules.get(schedule.id))?.students).toEqual([ana]);
  });

  it('lists and resolves only the assignments active at the instant (R17)', async () => {
    const f = buildSchedulesFixture();
    const { schedule } = await f.weekly('Morning', '10:00', '11:00');
    const ana = await f.newStudent('1');
    await f.schedules.assignStudent(schedule.id, ana.id);
    f.setNow(new Date('2026-11-02T15:30:00Z'));
    expect(
      await f.instances.resolveForStudent(ana.id, f.clock.now()),
    ).not.toBeNull();
    expect(
      (await f.instances.listActive(f.clock.now()))[0]?.studentIds,
    ).toEqual([ana.id]);

    await f.schedules.unassignStudent(schedule.id, ana.id);

    expect(
      await f.instances.resolveForStudent(ana.id, f.clock.now()),
    ).toBeNull();
    expect(
      (await f.instances.listActive(f.clock.now()))[0]?.studentIds,
    ).toEqual([]);
    expect((await f.schedules.list())[0]?.students).toEqual([]);
  });

  it('audits only the real changes with the schedule and student ids (R19)', async () => {
    const f = buildSchedulesFixture();
    const { schedule } = await f.weekly('Morning', '10:00', '11:00');
    const ana = await f.newStudent('1');
    await f.schedules.assignStudent(schedule.id, ana.id);
    await f.schedules.assignStudent(schedule.id, ana.id);
    await f.schedules.unassignStudent(schedule.id, ana.id);
    await f.schedules.unassignStudent(schedule.id, ana.id);
    const events = f.eventLogRepo.entries.filter((e) =>
      e.type.startsWith('schedule.'),
    );
    expect(events.map((e) => e.type)).toEqual([
      'schedule.created',
      'schedule.student_assigned',
      'schedule.student_unassigned',
    ]);
    expect(events[1]).toMatchObject({
      actor: { type: 'system', id: null },
      detail: { scheduleId: schedule.id, studentId: ana.id },
    });
  });

  it('reports a missing schedule or student', async () => {
    const f = buildSchedulesFixture();
    const { schedule } = await f.weekly('Morning', '10:00', '11:00');
    const ana = await f.newStudent('1');
    await expect(
      f.schedules.assignStudent('nope', ana.id),
    ).rejects.toMatchObject({ code: 'SCHEDULE_NOT_FOUND' });
    await expect(
      f.schedules.assignStudent(schedule.id, 'nope'),
    ).rejects.toBeInstanceOf(ScheduleLookupFailed);
    await expect(
      f.schedules.unassignStudent(schedule.id, 'nope'),
    ).rejects.toMatchObject({ code: 'STUDENT_NOT_FOUND' });
  });

  it('lists schedules with students and upcoming occurrences, and gets one by id', async () => {
    const f = buildSchedulesFixture();
    const a = await f.weekly('A', '10:00', '11:00');
    await f.weekly('B', '12:00', '13:00');
    const ana = await f.newStudent('1');
    await f.schedules.assignStudent(a.schedule.id, ana.id);
    const list = await f.schedules.list();
    expect(list.map((d) => d.schedule.name)).toEqual(['A', 'B']);
    expect(list[0].students).toEqual([ana]);
    expect(list[1].students).toEqual([]);
    expect(list.every((d) => d.upcoming.length === 1)).toBe(true);
    expect((await f.schedules.get(a.schedule.id))?.schedule.name).toBe('A');
    expect(await f.schedules.get('nope')).toBeNull();
  });
});
