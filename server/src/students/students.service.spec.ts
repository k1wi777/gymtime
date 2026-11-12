import { DuplicateDocumentError } from './domain/student.js';
import { DisplayValidationError } from '../common/display/display.errors.js';
import type { InMemoryEventLogRepository } from '../common/audit/in-memory-event-log.repository.js';
import type { StudentsService } from './students.service.js';
import { runAsActor } from '../common/audit/actor.js';
import { PROVISIONAL_VERSION as CONSENT_VERSION } from './consent.loader.js';
import { ConsentVersionStaleError } from './students.service.js';
import { buildStudentsService } from './testing.js';

const data = (document = '100') => ({
  document,
  name: 'Ana',
  program: null,
  consented: true,
});

const LONG_NAME = 'Ana María Gómez Pérez de la Hoz Castro'; // over 24 characters

describe('StudentsService', () => {
  let service: StudentsService;
  let eventLog: InMemoryEventLogRepository;

  beforeEach(() => {
    ({ service, eventLog } = buildStudentsService());
  });

  it('creates an active student', async () => {
    const student = await service.create(data());
    expect(student).toMatchObject({ document: '100', active: true });
    expect(await service.findById(student.id)).toEqual(student);
  });

  it('finds students by ids and ignores unknown ones', async () => {
    const a = await service.create(data('100'));
    await service.create(data('101'));
    expect(await service.findByIds([a.id, 'missing'])).toEqual([a]);
    expect(await service.findByIds([])).toEqual([]);
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

  it('edits name and program but never the document', async () => {
    const { id } = await service.create(data());
    const updated = await service.update(id, {
      name: 'Bea',
      program: 'Yoga',
    });
    expect(updated).toMatchObject({
      document: '100',
      name: 'Bea',
      program: 'Yoga',
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

  describe('display name (R8, R9)', () => {
    it('uses the full name when it fits, keeping accents', async () => {
      const student = await service.create({ ...data(), name: 'María Núñez' });
      expect(student.displayName).toBe('María Núñez');
    });

    it('shortens a long name to the first name and the next initial', async () => {
      const student = await service.create({ ...data(), name: LONG_NAME });
      expect(student.displayName).toBe('Ana M.');
    });

    it('accepts a custom display name and normalizes it', async () => {
      const student = await service.create({
        ...data(),
        displayName: 'Ñoño',
      });
      expect(student.displayName).toBe('Ñoño');
    });

    it('rejects a display name that does not fit the screen', async () => {
      await expect(
        service.create({ ...data(), displayName: 'x'.repeat(25) }),
      ).rejects.toBeInstanceOf(DisplayValidationError);
      const { id } = await service.create(data());
      await expect(
        service.update(id, { displayName: 'x'.repeat(25) }),
      ).rejects.toBeInstanceOf(DisplayValidationError);
      await expect(
        service.update(id, { displayName: '   ' }),
      ).rejects.toBeInstanceOf(DisplayValidationError);
    });

    it('regenerates it when the name changes and it was not customised', async () => {
      const { id } = await service.create({ ...data(), name: LONG_NAME });
      const updated = await service.update(id, {
        name: 'Luis Alberto Mora Ruiz de la Torre Gómez',
      });
      expect(updated?.displayName).toBe('Luis A.');
    });

    it('keeps a customised display name when the name changes', async () => {
      const { id } = await service.create({ ...data(), displayName: 'Anita' });
      const updated = await service.update(id, { name: 'Ana Maria' });
      expect(updated?.displayName).toBe('Anita');
    });

    it('lets the display name be edited explicitly', async () => {
      const { id } = await service.create(data());
      const updated = await service.update(id, { displayName: 'Anita' });
      expect(updated?.displayName).toBe('Anita');
    });
  });

  describe('contact data', () => {
    it('is optional and stored when given', async () => {
      const plain = await service.create(data('1'));
      expect(plain).toMatchObject({ email: null, phone: null });
      const full = await service.create({
        ...data('2'),
        email: 'ana@unicordoba.edu.co',
        phone: '+57 300 123 4567',
      });
      expect(full).toMatchObject({
        email: 'ana@unicordoba.edu.co',
        phone: '+57 300 123 4567',
      });
    });

    it('is editable and can be cleared', async () => {
      const { id } = await service.create(data());
      expect(
        await service.update(id, { email: 'a@b.co', phone: '3001234567' }),
      ).toMatchObject({ email: 'a@b.co', phone: '3001234567' });
      expect(
        await service.update(id, { email: null, phone: null }),
      ).toMatchObject({ email: null, phone: null });
    });

    it('keeps deactivation working with contact data', async () => {
      const { id } = await service.create({ ...data(), email: 'a@b.co' });
      expect((await service.deactivate(id))?.active).toBe(false);
    });
  });

  describe('audit trail (R19)', () => {
    it('records creation, edition and deactivation without personal data', async () => {
      const { id } = await service.create({
        ...data(),
        email: 'secret@example.com',
        phone: '3001234567',
      });
      await service.update(id, { name: 'Bea', email: 'other@example.com' });
      await service.deactivate(id);
      expect(eventLog.entries.map((e) => e.type)).toEqual([
        'student.created',
        'student.consent_recorded',
        'student.updated',
        'student.deactivated',
      ]);
      expect(eventLog.entries[2]?.detail).toEqual({
        studentId: id,
        fields: ['name', 'email'],
      });
      expect(JSON.stringify(eventLog.entries)).not.toMatch(
        /secret@|other@|3001234567/,
      );
      expect(eventLog.entries.every((e) => e.actor.type === 'system')).toBe(
        true,
      );
    });
  });

  describe('consent (R17)', () => {
    it('records version, date and author, and is idempotent', async () => {
      const { id } = await service.create({ ...data(), consented: false });
      expect((await service.findById(id))?.consented).toBe(false);
      const first = await runAsActor({ type: 'user', id: 'u1' }, () =>
        service.recordConsent(id, CONSENT_VERSION),
      );
      expect(first).toMatchObject({
        consented: true,
        consentVersion: CONSENT_VERSION,
      });
      expect(first?.consentAt).toBeInstanceOf(Date);
      const again = await service.recordConsent(id, CONSENT_VERSION);
      expect(again?.consentAt).toEqual(first?.consentAt);
      const audited = eventLog.entries.filter(
        (e) => e.type === 'student.consent_recorded',
      );
      expect(audited).toHaveLength(1);
      expect(audited[0]).toMatchObject({
        actor: { type: 'user', id: 'u1' },
        detail: { studentId: id, version: CONSENT_VERSION },
      });
    });

    it('refuses a version that is not the current text', async () => {
      const { id } = await service.create({ ...data(), consented: false });
      await expect(service.recordConsent(id, 'v0')).rejects.toBeInstanceOf(
        ConsentVersionStaleError,
      );
      expect((await service.findById(id))?.consented).toBe(false);
    });

    it('returns null for an unknown student', async () => {
      expect(
        await service.recordConsent(crypto.randomUUID(), CONSENT_VERSION),
      ).toBeNull();
    });

    it('accepts consented: true as a shortcut when creating or editing', async () => {
      const created = await service.create(data());
      expect(created).toMatchObject({
        consented: true,
        consentVersion: CONSENT_VERSION,
      });
      const other = await service.create({ ...data('200'), consented: false });
      expect(other.consented).toBe(false);
      const edited = await service.update(other.id, { consented: true });
      expect(edited?.consentVersion).toBe(CONSENT_VERSION);
    });

    it('does not move the date of an existing consent', async () => {
      const { id, consentAt } = await service.create(data());
      const edited = await service.update(id, { consented: true, name: 'B' });
      expect(edited?.consentAt).toEqual(consentAt);
    });
  });

  describe('search and filters (R12)', () => {
    it('finds by name or document, ignoring case and accents', async () => {
      await service.create({ ...data('1001'), name: 'María Pérez' });
      await service.create({ ...data('2002'), name: 'Luis', program: 'Yoga' });
      expect(
        (await service.list({ search: 'maria' })).map((s) => s.document),
      ).toEqual(['1001']);
      expect(
        (await service.list({ search: '200' })).map((s) => s.name),
      ).toEqual(['Luis']);
      expect(await service.list({ program: 'Yoga' })).toHaveLength(1);
    });
  });
});
