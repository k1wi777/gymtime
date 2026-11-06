import { OccurrenceRepairJob } from './occurrence-repair.job.js';
import { PeriodError } from './period.js';
import { buildSchedulesFixture } from '../testing.js';

const PERIOD = {
  name: '2026-2',
  startDate: '2026-11-02',
  endDate: '2026-11-30',
};

async function setup() {
  const f = buildSchedulesFixture();
  const { period } = await f.periods.create(PERIOD);
  /** Instance ids that have attendance or alarms. */
  const used = new Set<string>();
  f.instances.addHistoryProbe(async (ids) => ids.filter((id) => used.has(id)));
  const recurring = (weekday: number, start = '10:00', end = '11:00') =>
    f.schedules.create({
      name: `D${weekday} ${start}`,
      weekday,
      start,
      end,
      periodId: period.id,
    });
  const dates = async (scheduleId: string) =>
    (await f.instancesRepo.findFromDate([scheduleId], '2000-01-01')).map(
      (i) => i.date,
    );
  return { f, period, used, recurring, dates };
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof PeriodError ? error : error),
  );

describe('PeriodsService (E18-1, E18-2)', () => {
  it('rejects a period that ends before it starts', async () => {
    const f = buildSchedulesFixture();
    const error = await code(
      f.periods.create({ ...PERIOD, startDate: '2026-12-01' }),
    );
    expect(error).toMatchObject({ code: 'INVALID_RANGE' });
  });

  it('rejects overlapping periods on create, edit and activation, naming the conflict', async () => {
    const f = buildSchedulesFixture();
    await f.periods.create(PERIOD);
    const second = await f.periods.create({
      name: '2026-3',
      startDate: '2026-12-01',
      endDate: '2026-12-31',
    });
    const overlapping = await code(
      f.periods.create({ ...PERIOD, name: 'Otro', startDate: '2026-11-30' }),
    );
    expect(overlapping).toMatchObject({ code: 'PERIOD_OVERLAP' });
    expect((overlapping as Error).message).toContain('"2026-2"');
    const edit = await code(
      f.periods.update(second.period.id, { startDate: '2026-11-15' }),
    );
    expect(edit).toMatchObject({ code: 'PERIOD_OVERLAP' });
    // Adjacent periods are fine.
    await f.periods.update(second.period.id, { startDate: '2026-12-01' });
  });

  it('keeps at most one period active', async () => {
    const f = buildSchedulesFixture();
    const a = await f.periods.create(PERIOD);
    const b = await f.periods.create({
      name: 'b',
      startDate: '2026-12-01',
      endDate: '2026-12-31',
    });
    await f.periods.activate(a.period.id);
    await f.periods.activate(b.period.id);
    const active = (await f.periods.list()).filter((p) => p.period.active);
    expect(active.map((p) => p.period.name)).toEqual(['b']);
    await f.periods.deactivate(b.period.id);
    expect((await f.periods.list()).some((p) => p.period.active)).toBe(false);
  });

  it('does not delete a period with schedules, but deletes an empty one', async () => {
    const { f, period, recurring } = await setup();
    await recurring(1);
    expect(await code(f.periods.remove(period.id))).toMatchObject({
      code: 'PERIOD_HAS_SCHEDULES',
    });
    const empty = await f.periods.create({
      name: 'x',
      startDate: '2027-01-01',
      endDate: '2027-01-31',
    });
    await f.periods.remove(empty.period.id);
    expect(await code(f.periods.get(empty.period.id))).toMatchObject({
      code: 'PERIOD_NOT_FOUND',
    });
  });

  it('rejects days without service outside the period or reversed', async () => {
    const { f, period } = await setup();
    expect(
      await code(
        f.periods.addException(period.id, {
          from: '2026-10-30',
          to: '2026-11-03',
          reason: 'x',
        }),
      ),
    ).toMatchObject({ code: 'EXCEPTION_OUT_OF_PERIOD' });
    expect(
      await code(
        f.periods.addException(period.id, {
          from: '2026-11-10',
          to: '2026-11-09',
          reason: 'x',
        }),
      ),
    ).toMatchObject({ code: 'INVALID_RANGE' });
  });

  it('refuses to shrink a period so that a day without service falls outside', async () => {
    const { f, period } = await setup();
    await f.periods.addException(period.id, {
      from: '2026-11-25',
      to: '2026-11-26',
      reason: 'Receso',
    });
    expect(
      await code(f.periods.update(period.id, { endDate: '2026-11-20' })),
    ).toMatchObject({ code: 'PERIOD_EXCLUDES_EXCEPTION' });
  });

  it('audits the mutations with ids and field names only', async () => {
    const { f, period } = await setup();
    await f.periods.update(period.id, { name: 'Renombrado' });
    await f.periods.activate(period.id);
    const events = f.eventLogRepo.entries.filter((e) =>
      e.type.startsWith('period.'),
    );
    expect(events.map((e) => e.type)).toEqual([
      'period.created',
      'period.updated',
      'period.activated',
    ]);
    expect(events[1]?.detail).toEqual({
      periodId: period.id,
      fields: ['name'],
    });
  });
});

describe('Occurrences of a period (E18-3, E18-4, E18-6)', () => {
  it('generates the whole period when a recurring schedule is created', async () => {
    const { recurring, dates } = await setup();
    const created = await recurring(1);
    expect(created.regeneration).toEqual({
      created: 5,
      deleted: 0,
      updated: 0,
      kept: 0,
    });
    expect(await dates(created.schedule.id)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
  });

  it('omits the days without service, as many as the weekdays it covers', async () => {
    const { f, period, recurring, dates } = await setup();
    await f.periods.addException(period.id, {
      from: '2026-11-16',
      to: '2026-11-16',
      reason: 'Festivo',
    });
    const monday = await recurring(1);
    const tuesday = await recurring(2);
    expect(await dates(monday.schedule.id)).not.toContain('2026-11-16');
    expect(await dates(monday.schedule.id)).toHaveLength(4);
    expect(await dates(tuesday.schedule.id)).toContain('2026-11-17');
  });

  it('a one-off schedule and a quick schedule ignore the period and its days without service', async () => {
    const { f, period } = await setup();
    await f.periods.addException(period.id, {
      from: '2026-11-02',
      to: '2026-11-30',
      reason: 'Receso',
    });
    const oneOff = await f.schedules.create({
      name: 'Una vez',
      date: '2026-11-02',
      start: '15:00',
      end: '16:00',
    });
    const quick = await f.schedules.create({
      name: 'Rápido',
      endsInMinutes: 30,
    });
    expect(oneOff.upcoming).toHaveLength(1);
    expect(quick.upcoming).toHaveLength(1);
    const later = await f.periods.addException(period.id, {
      from: '2026-11-03',
      to: '2026-11-03',
      reason: 'x',
    });
    expect(later.regeneration).toEqual({
      created: 0,
      deleted: 0,
      updated: 0,
      kept: 0,
    });
    expect(
      await f.instancesRepo.findFromDate([oneOff.schedule.id], '2026-01-01'),
    ).toHaveLength(1);
  });

  it('adding a day without service deletes only the future occurrence without history', async () => {
    const { f, period, used, recurring, dates } = await setup();
    const { schedule } = await recurring(1);
    const all = await f.instancesRepo.findFromDate([schedule.id], '2026-11-01');
    const nov16 = all.find((i) => i.date === '2026-11-16');
    const nov23 = all.find((i) => i.date === '2026-11-23');
    used.add(nov23?.id ?? '');
    expect(nov16).toBeDefined();
    const result = await f.periods.addException(period.id, {
      from: '2026-11-16',
      to: '2026-11-23',
      reason: 'Receso',
    });
    expect(result.regeneration).toEqual({
      created: 0,
      deleted: 1,
      updated: 0,
      kept: 1,
    });
    // Nov 23 has attendance: it survives even though the day is now closed.
    expect(await dates(schedule.id)).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-23',
      '2026-11-30',
    ]);
  });

  it('removing a day without service brings the occurrence back', async () => {
    const { f, period, recurring, dates } = await setup();
    const { schedule } = await recurring(1);
    const { exception } = await f.periods.addException(period.id, {
      from: '2026-11-09',
      to: '2026-11-09',
      reason: 'x',
    });
    expect(await dates(schedule.id)).not.toContain('2026-11-09');
    const regeneration = await f.periods.removeException(
      period.id,
      exception.id,
    );
    expect(regeneration.created).toBe(1);
    expect(await dates(schedule.id)).toContain('2026-11-09');
  });

  it('editing the hours moves the future occurrences but never one with history or already started', async () => {
    const { f, used, recurring } = await setup();
    const { schedule } = await recurring(1);
    const all = await f.instancesRepo.findFromDate([schedule.id], '2026-11-01');
    // Today (Nov 2) started at 10:00? The clock is at 09:00: it is still future.
    used.add(all.find((i) => i.date === '2026-11-09')?.id ?? '');
    const edited = await f.schedules.update(schedule.id, {
      start: '14:00',
      end: '15:00',
    });
    expect(edited.regeneration).toEqual({
      created: 0,
      deleted: 0,
      updated: 4,
      kept: 1,
    });
    const after = await f.instancesRepo.findFromDate(
      [schedule.id],
      '2026-11-01',
    );
    const byDate = Object.fromEntries(
      after.map((i) => [i.date, i.startsAt.toISOString()]),
    );
    expect(byDate['2026-11-16']).toBe('2026-11-16T19:00:00.000Z');
    expect(byDate['2026-11-09']).toBe('2026-11-09T15:00:00.000Z');
  });

  it('keeps an occurrence that already started when the schedule changes', async () => {
    const { f, recurring, dates } = await setup();
    const { schedule } = await recurring(1, '08:00', '10:00');
    // 09:00 on Monday Nov 2: the first occurrence is in progress.
    const edited = await f.schedules.update(schedule.id, { weekday: 2 });
    expect(edited.regeneration?.kept).toBe(1);
    expect(await dates(schedule.id)).toContain('2026-11-02');
    expect(await dates(schedule.id)).toContain('2026-11-03');
  });

  it('shrinking or moving the period regenerates: creates the new days, deletes the ones outside', async () => {
    const { f, period, recurring, dates } = await setup();
    const { schedule } = await recurring(1);
    const shrunk = await f.periods.update(period.id, { endDate: '2026-11-15' });
    expect(shrunk.regeneration).toMatchObject({ deleted: 3 });
    expect(await dates(schedule.id)).toEqual(['2026-11-02', '2026-11-09']);
    const grown = await f.periods.update(period.id, { endDate: '2026-11-22' });
    expect(grown.regeneration).toMatchObject({ created: 1 });
    expect(await dates(schedule.id)).toHaveLength(3);
  });

  it('deleting a schedule is rejected when an occurrence has history, allowed otherwise', async () => {
    const { f, used, recurring } = await setup();
    const a = await recurring(1);
    const b = await recurring(2);
    const rows = await f.instancesRepo.findFromDate(
      [a.schedule.id],
      '2026-11-01',
    );
    used.add(rows[0]?.id ?? '');
    await expect(f.schedules.remove(a.schedule.id)).rejects.toMatchObject({
      name: 'Error',
      message: expect.stringContaining('asistencia'),
    });
    await f.schedules.remove(b.schedule.id);
    expect(await f.schedules.get(b.schedule.id)).toBeNull();
  });
});

describe('ensureHorizon with periods (E18-4 regression)', () => {
  it('does not recreate an occurrence on a day without service', async () => {
    const { f, period, recurring, dates } = await setup();
    const { schedule } = await recurring(2);
    await f.periods.addException(period.id, {
      from: '2026-11-03',
      to: '2026-11-03',
      reason: 'Festivo',
    });
    expect(await dates(schedule.id)).not.toContain('2026-11-03');
    await f.instances.ensureHorizon(f.clock.now());
    expect(await dates(schedule.id)).not.toContain('2026-11-03');
  });

  it('legacy recurring schedules keep the short horizon', async () => {
    const f = buildSchedulesFixture();
    const legacy = await f.weekly('Legado', '10:00', '11:00');
    expect(legacy.regeneration).toBeUndefined();
    expect(legacy.upcoming).toHaveLength(1);
    await f.instances.ensureHorizon(addDaysDate(f.clock.now(), 7));
    expect(
      await f.instancesRepo.findFromDate([legacy.schedule.id], '2026-11-01'),
    ).toHaveLength(2);
  });
});

const addDaysDate = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000);

describe('OccurrenceRepairJob (E18-5)', () => {
  async function jobSetup() {
    const s = await setup();
    await s.f.periods.activate(s.period.id);
    const created = await s.recurring(1);
    const job = new OccurrenceRepairJob(
      s.f.instances,
      new (
        await import('../../common/audit/event-log.service.js')
      ).EventLogService(s.f.eventLogRepo),
      s.f.clock,
    );
    return { ...s, job, schedule: created.schedule };
  }

  it('creates what is missing in the active period, logs it and is idempotent', async () => {
    const { f, job, schedule, dates } = await jobSetup();
    const rows = await f.instancesRepo.findFromDate(
      [schedule.id],
      '2026-11-01',
    );
    await f.instancesRepo.deleteByIds([rows[3]?.id ?? '', rows[4]?.id ?? '']);
    expect(await dates(schedule.id)).toHaveLength(3);
    expect(await job.check()).toBe(2);
    expect(await dates(schedule.id)).toHaveLength(5);
    expect(
      f.eventLogRepo.entries.filter(
        (e) => e.type === 'period.occurrences_repaired',
      ),
    ).toMatchObject([{ detail: { created: 2 }, actor: { type: 'system' } }]);
    // Same day: nothing to do; next day with nothing missing: zero.
    expect(await job.check()).toBe(0);
    f.setNow(new Date('2026-11-03T14:00:00Z'));
    expect(await job.check()).toBe(0);
  });

  it('does nothing without an active period', async () => {
    const { f, job, period } = await jobSetup();
    await f.periods.deactivate(period.id);
    expect(await job.check()).toBe(0);
  });

  it('logs a failure and does not throw, then retries', async () => {
    const { f, job, dates, schedule } = await jobSetup();
    const spy = vi
      .spyOn(f.instances, 'repairActivePeriod')
      .mockRejectedValueOnce(new Error('db down'));
    await expect(job.check()).resolves.toBe(0);
    spy.mockRestore();
    const rows = await f.instancesRepo.findFromDate(
      [schedule.id],
      '2026-11-01',
    );
    await f.instancesRepo.deleteByIds([rows[4]?.id ?? '']);
    expect(await job.check()).toBe(1);
    expect(await dates(schedule.id)).toHaveLength(5);
  });
});
