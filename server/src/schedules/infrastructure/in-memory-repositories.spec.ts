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
  it('assigns and unassigns students idempotently', async () => {
    const repo = new InMemorySchedulesRepository();
    const s = await repo.create(base);
    await repo.assignStudent(s.id, 'a');
    await repo.assignStudent(s.id, 'a');
    expect((await repo.listStudentIds([s.id])).get(s.id)).toEqual(['a']);
    expect(await repo.findByStudent('a')).toHaveLength(1);
    await repo.unassignStudent(s.id, 'a');
    await repo.unassignStudent(s.id, 'a');
    expect((await repo.listStudentIds([s.id])).get(s.id)).toEqual([]);
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
