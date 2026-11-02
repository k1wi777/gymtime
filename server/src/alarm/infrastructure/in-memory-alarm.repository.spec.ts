import { InMemoryAlarmRepository } from './in-memory-alarm.repository.js';

const at = (minutes: number) => new Date(`2026-11-02T15:${minutes}:00Z`);

describe('InMemoryAlarmRepository', () => {
  it('creates open events and lists them oldest first', async () => {
    const repo = new InMemoryAlarmRepository();
    const later = await repo.create({ instanceId: 'i2', startedAt: at(20) });
    const earlier = await repo.create({ instanceId: 'i1', startedAt: at(10) });

    expect(await repo.findOpen()).toEqual([earlier, later]);
    expect(await repo.findOpenByInstance('i1')).toEqual(earlier);
    expect(await repo.findOpenByInstance('missing')).toBeNull();
  });

  it('closes once with the audit fields and leaves it out of the open list', async () => {
    const repo = new InMemoryAlarmRepository();
    const event = await repo.create({ instanceId: 'i1', startedAt: at(0) });

    const closed = await repo.close(event.id, {
      endedAt: at(30),
      closedBy: 'button',
      closedSessions: 2,
    });

    expect(closed).toMatchObject({
      id: event.id,
      endedAt: at(30),
      closedBy: 'button',
      closedSessions: 2,
    });
    expect(await repo.findOpen()).toEqual([]);
    expect(
      await repo.close(event.id, {
        endedAt: at(31),
        closedBy: 'timeout',
        closedSessions: 0,
      }),
    ).toBeNull();
  });
});
