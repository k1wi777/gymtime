import { DuplicateDocumentError } from './domain/student.js';
import { InMemoryStudentsRepository } from './infrastructure/in-memory-students.repository.js';
import { StudentsService } from './students.service.js';

const data = (document = '100') => ({
  document,
  name: 'Ana',
  program: null,
  consented: true,
});

describe('StudentsService', () => {
  let service: StudentsService;

  beforeEach(() => {
    service = new StudentsService(new InMemoryStudentsRepository());
  });

  it('creates an active student', async () => {
    const student = await service.create(data());
    expect(student).toMatchObject({ document: '100', active: true });
    expect(await service.findById(student.id)).toEqual(student);
  });

  it('rejects a duplicate document without changing data', async () => {
    await service.create(data());
    await expect(
      service.create({ ...data(), name: 'Other' }),
    ).rejects.toBeInstanceOf(DuplicateDocumentError);
    expect(await service.list()).toHaveLength(1);
    expect((await service.list())[0]?.name).toBe('Ana');
  });

  it('lists with an active filter', async () => {
    const a = await service.create(data('1'));
    await service.create(data('2'));
    await service.deactivate(a.id);
    expect(await service.list({ active: true })).toHaveLength(1);
    expect(await service.list({ active: false })).toHaveLength(1);
    expect(await service.list()).toHaveLength(2);
  });

  it('edits name, program and consent but never the document', async () => {
    const { id } = await service.create(data());
    const updated = await service.update(id, {
      name: 'Bea',
      program: 'Yoga',
      consented: false,
    });
    expect(updated).toMatchObject({
      document: '100',
      name: 'Bea',
      program: 'Yoga',
      consented: false,
    });
    expect(await service.update(crypto.randomUUID(), { name: 'x' })).toBeNull();
  });

  it('deactivates keeping the record and notifies listeners', async () => {
    const { id } = await service.create(data());
    const listener = vi.fn();
    service.onDeactivated(listener);
    const student = await service.deactivate(id);
    expect(student?.active).toBe(false);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id }));
    expect(await service.findById(id)).toMatchObject({ active: false });
  });

  it('is idempotent and returns null for unknown ids', async () => {
    const { id } = await service.create(data());
    await service.deactivate(id);
    expect((await service.deactivate(id))?.active).toBe(false);
    expect(await service.deactivate(crypto.randomUUID())).toBeNull();
  });

  it('keeps the student inactive when a listener fails', async () => {
    const { id } = await service.create(data());
    service.onDeactivated(() => {
      throw new Error('boom');
    });
    expect((await service.deactivate(id))?.active).toBe(false);
  });
});
