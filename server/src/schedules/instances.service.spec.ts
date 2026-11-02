import { buildSchedulesFixture } from './testing.js';

const bogota = (hhmm: string, date = '2026-11-02') =>
  new Date(`${date}T${hhmm}:00-05:00`);

describe('InstancesService.ensureHorizon (R5)', () => {
  it('generates today and the horizon days, idempotently', async () => {
    const f = buildSchedulesFixture();
    await f.weekly('Daily-ish', '10:00', '11:00');
    await f.schedules.create({
      name: 'Once',
      date: '2026-11-04',
      start: '10:00',
      end: '11:00',
    });
    // creation already generated them (today, and the one-off at day +2)
    expect(await f.instances.ensureHorizon(f.clock.now())).toBe(0);
    expect(await f.instances.ensureHorizon(f.clock.now())).toBe(0);
    // a week later the weekly schedule has a new Monday occurrence
    expect(await f.instances.ensureHorizon(bogota('09:00', '2026-11-09'))).toBe(
      1,
    );
  });

  it('does not generate for dates that do not match the weekday', async () => {
    const f = buildSchedulesFixture(bogota('09:00', '2026-11-03')); // Tuesday
    await f.weekly('Mondays', '10:00', '11:00');
    expect(await f.instances.ensureHorizon(f.clock.now())).toBe(0);
  });
});

describe('InstancesService.resolveForStudent (R8)', () => {
  async function twoBackToBack() {
    const f = buildSchedulesFixture();
    const a = await f.weekly('A', '10:00', '11:00');
    const b = await f.weekly('B', '11:00', '12:00');
    const ana = await f.newStudent('1');
    await f.schedules.assignStudent(a.schedule.id, ana.id);
    await f.schedules.assignStudent(b.schedule.id, ana.id);
    return { f, a, b, ana };
  }

  it('returns null outside every window or for unassigned students', async () => {
    const { f, ana } = await twoBackToBack();
    expect(
      await f.instances.resolveForStudent(ana.id, bogota('09:30')),
    ).toBeNull();
    expect(
      await f.instances.resolveForStudent(ana.id, bogota('12:00')),
    ).toBeNull();
    const other = await f.newStudent('2');
    expect(
      await f.instances.resolveForStudent(other.id, bogota('10:30')),
    ).toBeNull();
  });

  it('opens entry 10 minutes before the start', async () => {
    const { f, a, ana } = await twoBackToBack();
    const early = await f.instances.resolveForStudent(ana.id, bogota('09:50'));
    expect(early).toMatchObject({ entryOpen: true });
    expect(early?.instance.scheduleId).toBe(a.schedule.id);
  });

  it('prefers the schedule with entry open when two are back to back', async () => {
    const { f, a, b, ana } = await twoBackToBack();
    const at = async (hhmm: string) =>
      f.instances.resolveForStudent(ana.id, bogota(hhmm));
    expect((await at('10:30'))?.instance.scheduleId).toBe(a.schedule.id);
    expect((await at('10:49'))?.instance.scheduleId).toBe(a.schedule.id);
    expect((await at('10:52'))?.instance.scheduleId).toBe(b.schedule.id); // both open
    expect((await at('10:56'))?.instance.scheduleId).toBe(b.schedule.id); // A closed
    expect(await at('10:56')).toMatchObject({ entryOpen: true });
  });

  it('falls back to the one in progress once entry closed', async () => {
    const f = buildSchedulesFixture();
    const a = await f.weekly('A', '10:00', '11:00');
    const ana = await f.newStudent('1');
    await f.schedules.assignStudent(a.schedule.id, ana.id);
    const late = await f.instances.resolveForStudent(ana.id, bogota('10:57'));
    expect(late).toMatchObject({ entryOpen: false });
    expect(late?.instance.scheduleId).toBe(a.schedule.id);
  });

  it('honours the schedule margins over the defaults', async () => {
    const f = buildSchedulesFixture();
    const s = await f.schedules.create({
      name: 'Wide',
      weekday: 1,
      start: '10:00',
      end: '11:00',
      entryOpenMinutes: 0,
      entryCloseMinutes: 30,
    });
    const ana = await f.newStudent('1');
    await f.schedules.assignStudent(s.schedule.id, ana.id);
    expect(
      await f.instances.resolveForStudent(ana.id, bogota('09:59')),
    ).toBeNull();
    expect(
      await f.instances.resolveForStudent(ana.id, bogota('10:29')),
    ).toMatchObject({ entryOpen: true });
    expect(
      await f.instances.resolveForStudent(ana.id, bogota('10:30')),
    ).toMatchObject({ entryOpen: false });
  });
});

describe('InstancesService.listRelevant (R9 input)', () => {
  it('returns occurrences in progress or starting within the lead, with students', async () => {
    const f = buildSchedulesFixture();
    const inProgress = await f.weekly('Now', '08:30', '09:30');
    const soon = await f.weekly('Soon', '09:10', '10:00');
    const later = await f.weekly('Later', '09:30', '10:00');
    const ended = await f.weekly('Ended', '08:00', '09:00');
    const ana = await f.newStudent('1');
    await f.schedules.assignStudent(inProgress.schedule.id, ana.id);
    await f.schedules.assignStudent(soon.schedule.id, ana.id);
    await f.schedules.assignStudent(later.schedule.id, ana.id);
    await f.schedules.assignStudent(ended.schedule.id, ana.id);
    const relevant = await f.instances.listRelevant(f.clock.now(), 15);
    expect(relevant.map((o) => o.schedule.name)).toEqual(['Now', 'Soon']);
    expect(relevant[0].studentIds).toEqual([ana.id]);
  });
});

describe('InstancesService.listWithEdgesBetween', () => {
  it('finds the lead trigger and the end inside the interval only', async () => {
    const f = buildSchedulesFixture();
    await f.weekly('A', '09:20', '09:40');
    const at = (hhmm: string) => bogota(hhmm);
    const first = await f.instances.listWithEdgesBetween(
      at('09:00'),
      at('09:06'),
      15,
    );
    expect(first.starting).toHaveLength(1); // 09:05 = 09:20 - 15
    expect(first.ended).toHaveLength(0);
    const again = await f.instances.listWithEdgesBetween(
      at('09:06'),
      at('09:30'),
      15,
    );
    expect(again.starting).toHaveLength(0);
    const end = await f.instances.listWithEdgesBetween(
      at('09:30'),
      at('09:41'),
      15,
    );
    expect(end.ended).toHaveLength(1);
  });
});
