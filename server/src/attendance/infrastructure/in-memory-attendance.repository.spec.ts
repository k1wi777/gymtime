import { InMemoryAttendanceRepository } from './in-memory-attendance.repository.js';

const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);

function build() {
  const repo = new InMemoryAttendanceRepository();
  return { repo };
}

describe('InMemoryAttendanceRepository', () => {
  it('creates an open session and closes it once', async () => {
    const { repo } = build();
    const created = await repo.create({
      studentId: 's1',
      instanceId: 'i1',
      enteredAt: at('10:00'),
      entrySource: 'device',
    });
    expect(created).toMatchObject({
      status: 'abierta',
      exitedAt: null,
      exitSource: null,
      manualReason: null,
    });

    const closed = await repo.close(created.id, {
      exitedAt: at('10:30'),
      exitSource: 'manual',
      manualReason: 'se retiró antes',
    });
    expect(closed).toMatchObject({
      status: 'cerrada',
      exitedAt: at('10:30'),
      exitSource: 'manual',
      manualReason: 'se retiró antes',
    });
    expect(
      await repo.close(created.id, {
        exitedAt: at('11:00'),
        exitSource: 'device',
      }),
    ).toBeNull();
    expect(await repo.findOpenByStudent('s1')).toBeNull();
  });

  it('counts open sessions per occurrence and lists open students once', async () => {
    const { repo } = build();
    await repo.create({
      studentId: 's1',
      instanceId: 'i1',
      enteredAt: at('10:00'),
      entrySource: 'device',
    });
    const second = await repo.create({
      studentId: 's1',
      instanceId: 'i2',
      enteredAt: at('11:00'),
      entrySource: 'manual',
    });
    await repo.create({
      studentId: 's2',
      instanceId: 'i1',
      enteredAt: at('10:05'),
      entrySource: 'device',
    });
    await repo.close(second.id, {
      exitedAt: at('12:00'),
      exitSource: 'device',
    });

    expect(await repo.countOpenByInstance('i1')).toBe(2);
    expect(await repo.countOpenByInstance('i2')).toBe(0);
    expect((await repo.listOpenStudentIds()).sort()).toEqual(['s1', 's2']);
    expect(await repo.listClosedInstanceIds('s1')).toEqual(['i2']);
    expect(await repo.listClosedInstanceIds('s2')).toEqual([]);
  });

  it('filters by student, occurrence, status and entry range, with limit', async () => {
    const { repo } = build();
    await repo.create({
      studentId: 's1',
      instanceId: 'i1',
      enteredAt: at('09:00'),
      entrySource: 'device',
    });
    const closed = await repo.create({
      studentId: 's1',
      instanceId: 'i2',
      enteredAt: at('10:00'),
      entrySource: 'device',
    });
    await repo.close(closed.id, {
      exitedAt: at('11:00'),
      exitSource: 'device',
    });
    await repo.create({
      studentId: 's2',
      instanceId: 'i1',
      enteredAt: at('12:00'),
      entrySource: 'manual',
    });

    expect(await repo.list({ studentId: 's1' })).toHaveLength(2);
    expect(await repo.list({ instanceId: 'i1' })).toHaveLength(2);
    expect(await repo.list({ status: 'abierta' })).toHaveLength(2);
    expect(await repo.list({ from: at('09:30'), to: at('11:30') })).toHaveLength(
      1,
    );
    expect(await repo.list({ limit: 1 })).toHaveLength(1);
    expect((await repo.list())[0].enteredAt).toEqual(at('09:00'));
  });
});
