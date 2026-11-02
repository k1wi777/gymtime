import { InMemorySlotsRepository } from './in-memory-slots.repository.js';

describe('InMemorySlotsRepository (R10)', () => {
  it('replaces the whole map of a device and answers slot lookups', async () => {
    const repo = new InMemorySlotsRepository();
    await repo.replace('d1', 'sync-1', [
      { slot: 1, fingerprintId: 'f1', studentId: 's1' },
      { slot: 2, fingerprintId: 'f2', studentId: 's2' },
    ]);
    await repo.replace('d2', 'sync-x', [
      { slot: 1, fingerprintId: 'f9', studentId: 's9' },
    ]);
    expect(await repo.findStudentIdBySlot('d1', 2)).toBe('s2');
    await repo.replace('d1', 'sync-2', [
      { slot: 1, fingerprintId: 'f3', studentId: 's3' },
    ]);
    expect(await repo.findStudentIdBySlot('d1', 2)).toBeNull();
    expect(await repo.findStudentIdBySlot('d1', 1)).toBe('s3');
    expect(await repo.findStudentIdBySlot('d2', 1)).toBe('s9');
    expect(await repo.findByDevice('d1')).toHaveLength(1);
  });
});
