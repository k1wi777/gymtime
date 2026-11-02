import { randomUUID } from 'node:crypto';
import {
  DuplicateDocumentError,
  type NewStudent,
  type Student,
  type StudentPatch,
} from '../domain/student.js';
import type { StudentsRepository } from '../domain/students.repository.js';

export class InMemoryStudentsRepository implements StudentsRepository {
  private readonly students = new Map<string, Student>();

  async create(data: NewStudent) {
    const taken = [...this.students.values()].some(
      (s) => s.document === data.document,
    );
    if (taken) throw new DuplicateDocumentError();
    const student: Student = { id: randomUUID(), active: true, ...data };
    this.students.set(student.id, student);
    return { ...student };
  }

  async findById(id: string) {
    const student = this.students.get(id);
    return student ? { ...student } : null;
  }

  async findAll(filter: { active?: boolean }) {
    return [...this.students.values()]
      .filter((s) => filter.active === undefined || s.active === filter.active)
      .map((s) => ({ ...s }));
  }

  async update(id: string, patch: StudentPatch) {
    return this.change(id, patch);
  }

  async deactivate(id: string) {
    return this.change(id, { active: false });
  }

  private change(id: string, changes: Partial<Student>) {
    const student = this.students.get(id);
    if (!student) return null;
    const updated = { ...student, ...changes };
    this.students.set(id, updated);
    return { ...updated };
  }
}
