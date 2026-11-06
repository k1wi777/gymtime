import { InMemoryInstancesRepository } from './in-memory-instances.repository.js';
import { InMemorySchedulesRepository } from './in-memory-schedules.repository.js';

const base = {
  name: 'Morning',
  weekday: 1,
  date: null,
  startTime: '10:00:00',
  endTime: '11:00:00',
  entryOpenMinutes: null,
  entryCloseMinutes: null,
};

describe('InMemorySchedulesRepository', () => {
  const t = (minute: number) => new Date(Date.UTC(2026, 10, 2, 15, minute));

  it('assigns and unassigns students idempotently, keeping the rows', async () => {
    const repo = new InMemorySchedulesRepository();
    const s = await repo.create(base);
    expect(await repo.assignStudent(s.id, 'a', t(0))).toBe(true);
    expect(await repo.assignStudent(s.id, 'a', t(1))).toBe(false);
    expect((await repo.listStudentIds([s.id], t(2))).get(s.id)).toEqual(['a']);
    expect(await repo.findByStudent('a', t(2))).toHaveLength(1);
    expect(await repo.unassignStudent(s.id, 'a', t(5))).toBe(true);
    expect(await repo.unassignStudent(s.id, 'a', t(6))).toBe(false);
    expect((await repo.listStudentIds([s.id], t(6))).get(s.id)).toEqual([]);
    expect(await repo.listAssignments(s.id)).toHaveLength(1);
  });

  it('answers by instant: before the start and from the end it is not active', async () => {
    const repo = new InMemorySchedulesRepository();
    const s = await repo.create(base);
    await repo.assignStudent(s.id, 'a', t(10));
    await repo.unassignStudent(s.id, 'a', t(20));
    const at = (minute: number) => repo.listStudentIds([s.id], t(minute));
    expect((await at(9)).get(s.id)).toEqual([]);
    expect((await at(10)).get(s.id)).toEqual(['a']);
    expect((await at(19)).get(s.id)).toEqual(['a']);
    expect((await at(20)).get(s.id)).toEqual([]);
    expect(await repo.findByStudent('a', t(25))).toHaveLength(0);
  });

  it('opens a new interval when the student is assigned again', async () => {
    const repo = new InMemorySchedulesRepository();
    const s = await repo.create(base);
    await repo.assignStudent(s.id, 'a', t(0));
    await repo.unassignStudent(s.id, 'a', t(5));
    expect(await repo.assignStudent(s.id, 'a', t(10))).toBe(true);
    const history = await repo.listAssignments(s.id);
    expect(history.map((a) => [a.validFrom, a.validTo])).toEqual([
      [t(0), t(5)],
      [t(10), null],
    ]);
  });
});

describe('InMemoryInstancesRepository', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 2, h));

  it('skips duplicates of the same schedule and date', async () => {
    const repo = new InMemoryInstancesRepository();
    const item = {
      scheduleId: 's',
      date: '2026-11-02',
      startsAt: at(15),
      endsAt: at(16),
    };
    expect(await repo.createMany([item, item])).toBe(1);
    expect(await repo.createMany([item])).toBe(0);
  });

  it('finds the occurrences overlapping a range, optionally per schedule', async () => {
    const repo = new InMemoryInstancesRepository();
    await repo.createMany([
      {
        scheduleId: 's1',
        date: '2026-11-02',
        startsAt: at(15),
        endsAt: at(16),
      },
      {
        scheduleId: 's2',
        date: '2026-11-02',
        startsAt: at(18),
        endsAt: at(19),
      },
    ]);
    expect(await repo.findInRange(at(16), at(17))).toHaveLength(1);
    expect(await repo.findInRange(at(10), at(20))).toHaveLength(2);
    expect(await repo.findInRange(at(10), at(20), ['s2'])).toHaveLength(1);
    expect(await repo.findInRange(at(17), at(17))).toHaveLength(0);
  });
});
