import { SLOT_MAX } from '@gymtime/shared';
import { validTemplate } from '../fingerprints/testing.js';
import { EmptyOpenSessionsProvider } from './domain/open-sessions.provider.js';
import { buildSyncFixture } from './testing.js';

const empty = new EmptyOpenSessionsProvider();

describe('SyncPlanner (R9-R12, R16)', () => {
  it('plans the students of schedules in progress or starting within the lead', async () => {
    const f = buildSyncFixture(); // Monday 09:00 Bogota
    const now = await f.weekly('Now', '08:30', '09:30');
    const soon = await f.weekly('Soon', '09:10', '10:00');
    const later = await f.weekly('Later', '09:30', '10:00');
    const a = await f.enroll('1', 1, [now.schedule.id]);
    const b = await f.enroll('2', 2, [soon.schedule.id]);
    await f.enroll('3', 3, [later.schedule.id]);

    const plan = await f.planner.build(f.clock.now(), empty);
    expect(plan.slots).toEqual([
      { slot: 1, studentId: a.id, fingerprintId: expect.any(String) },
      { slot: 2, studentId: b.id, fingerprintId: expect.any(String) },
    ]);
    expect(plan.templates.map((t) => t.toString('base64'))).toEqual([
      validTemplate(1),
      validTemplate(2),
    ]);
    expect(plan.omitted).toBe(0);
    expect(plan.schedule?.scheduleId).toBe(now.schedule.id); // in progress wins
  });

  it('leaves out a student whose assignment was closed (R17)', async () => {
    const f = buildSyncFixture();
    const now = await f.weekly('Now', '08:30', '09:30');
    const a = await f.enroll('1', 1, [now.schedule.id]);
    await f.enroll('2', 2, [now.schedule.id]);
    await f.schedules.unassignStudent(now.schedule.id, a.id);

    const plan = await f.planner.build(f.clock.now(), empty);

    expect(plan.slots.map((s) => s.studentId)).not.toContain(a.id);
    expect(plan.slots).toHaveLength(1);
  });

  it('does not repeat a student present in several schedules or open sessions', async () => {
    const f = buildSyncFixture();
    const s1 = await f.weekly('A', '08:30', '09:30');
    const s2 = await f.weekly('B', '09:05', '10:00');
    const ana = await f.enroll('1', 1, [s1.schedule.id, s2.schedule.id]);
    const plan = await f.planner.build(f.clock.now(), {
      listStudentIds: async () => [ana.id],
    });
    expect(plan.slots.map((s) => s.studentId)).toEqual([ana.id]);
  });

  it('includes open-session students even with no schedule, first', async () => {
    const f = buildSyncFixture();
    const s = await f.weekly('A', '08:30', '09:30');
    const scheduled = await f.enroll('1', 1, [s.schedule.id]);
    const lingering = await f.enroll('2', 2);
    const plan = await f.planner.build(f.clock.now(), {
      listStudentIds: async () => [lingering.id],
    });
    expect(plan.slots.map((x) => x.studentId)).toEqual([
      lingering.id,
      scheduled.id,
    ]);
  });

  it('ignores students without fingerprint or inactive, reporting them', async () => {
    const f = buildSyncFixture();
    const s = await f.weekly('A', '08:30', '09:30');
    const noPrint = await f.newStudent('1');
    const inactive = await f.enroll('2', 2, [s.schedule.id]);
    const ok = await f.enroll('3', 3, [s.schedule.id]);
    await f.schedules.assignStudent(s.schedule.id, noPrint.id);
    await f.students.deactivate(inactive.id);
    const plan = await f.planner.build(f.clock.now(), empty);
    expect(plan.slots.map((x) => x.studentId)).toEqual([ok.id]);
    expect(plan.skippedStudentIds.sort()).toEqual(
      [noPrint.id, inactive.id].sort(),
    );
  });

  it('truncates over capacity keeping open sessions and counts the omitted', async () => {
    const f = buildSyncFixture();
    const s = await f.weekly('A', '08:30', '09:30');
    const capacity = f.fingerprints.syncSlotCapacity;
    expect(capacity).toBe(SLOT_MAX - 1);
    const scheduled = [];
    for (let i = 0; i < capacity; i++) {
      scheduled.push(await f.enroll(`s${i}`, 1, [s.schedule.id]));
    }
    const lingering = await f.enroll('open', 2);
    const plan = await f.planner.build(f.clock.now(), {
      listStudentIds: async () => [lingering.id],
    });
    expect(plan.slots).toHaveLength(capacity);
    expect(plan.slots[0].studentId).toBe(lingering.id);
    expect(plan.slots.at(-1)?.slot).toBe(capacity);
    expect(plan.omitted).toBe(1);
    expect(plan.slots.map((x) => x.studentId)).not.toContain(
      scheduled.at(-1)?.id,
    );
  });

  it('yields an empty plan and no schedule when nothing is relevant', async () => {
    const f = buildSyncFixture();
    await f.weekly('Later', '12:00', '13:00');
    const plan = await f.planner.build(f.clock.now(), empty);
    expect(plan).toMatchObject({ slots: [], templates: [], schedule: null });
  });

  it('plans the nearest upcoming schedule when none is in progress, with its window', async () => {
    const f = buildSyncFixture();
    const soon = await f.weekly('Soon', '09:10', '10:00');
    const plan = await f.planner.build(f.clock.now(), empty);
    expect(plan.schedule).toMatchObject({
      scheduleId: soon.schedule.id,
      startsAt: new Date('2026-11-02T14:10:00Z'),
      entryOpensAt: new Date('2026-11-02T14:00:00Z'),
      entryClosesAt: new Date('2026-11-02T14:55:00Z'),
    });
  });
});
