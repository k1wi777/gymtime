import { randomUUID } from 'node:crypto';
import {
  DuplicateDocumentError,
  type ConsentRecord,
  type NewStudent,
  type Student,
  type StudentFilter,
  type StudentPatch,
} from '../domain/student.js';
import type { StudentsRepository } from '../domain/students.repository.js';

const norm = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class InMemoryStudentsRepository implements StudentsRepository {
  private readonly students = new Map<string, Student>();

  async create(data: NewStudent) {
    const taken = [...this.students.values()].some(
      (s) => s.document === data.document,
    );
    if (taken) throw new DuplicateDocumentError();
    const { consent, importBatchId: _batch, ...fields } = data;
    const student: Student = {
      id: randomUUID(),
      active: true,
      ...fields,
      consented: consent != null,
      consentVersion: consent?.version ?? null,
      consentAt: consent?.at ?? null,
    };
    this.students.set(student.id, student);
    return { ...student };
  }

  async createMany(data: NewStudent[]) {
    const documents = new Set<string>();
    for (const item of data) {
      const taken = [...this.students.values()].some(
        (s) => s.document === item.document,
      );
      if (taken || documents.has(item.document)) {
        throw new DuplicateDocumentError();
      }
      documents.add(item.document);
    }
    return Promise.all(data.map((item) => this.create(item)));
  }

  async findById(id: string) {
    const student = this.students.get(id);
    return student ? { ...student } : null;
  }

  async findByIds(ids: string[]) {
    return ids.flatMap((id) => {
      const student = this.students.get(id);
      return student ? [{ ...student }] : [];
    });
  }

  async findByDocuments(documents: string[]) {
    const wanted = new Set(documents);
    return [...this.students.values()]
      .filter((s) => wanted.has(s.document))
      .map((s) => ({ ...s }));
  }

  async findAll(filter: StudentFilter) {
    const needle = filter.search ? norm(filter.search) : null;
    return [...this.students.values()]
      .filter(
        (s) =>
          (filter.active === undefined || s.active === filter.active) &&
          (filter.program === undefined || s.program === filter.program) &&
          (needle === null ||
            norm(s.name).includes(needle) ||
            norm(s.document).includes(needle)),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ ...s }));
  }

  async update(id: string, patch: StudentPatch) {
    return this.change(id, patch);
  }

  async deactivate(id: string) {
    return this.change(id, { active: false });
  }

  async recordConsent(id: string, consent: ConsentRecord) {
    return this.change(id, {
      consented: true,
      consentVersion: consent.version,
      consentAt: consent.at,
    });
  }

  private change(id: string, changes: Partial<Student>) {
    const student = this.students.get(id);
    if (!student) return null;
    const updated = { ...student, ...changes };
    this.students.set(id, updated);
    return { ...updated };
  }
}
