import type { NewStudent, Student, StudentPatch } from './student.js';

export interface StudentsRepository {
  /** @throws DuplicateDocumentError when the document already exists. */
  create(data: NewStudent): Promise<Student>;
  findById(id: string): Promise<Student | null>;
  findByIds(ids: string[]): Promise<Student[]>;
  findAll(filter: { active?: boolean }): Promise<Student[]>;
  /** Returns null when the student does not exist. */
  update(id: string, patch: StudentPatch): Promise<Student | null>;
  /** Marks the student inactive; returns null when it does not exist. */
  deactivate(id: string): Promise<Student | null>;
}

export const STUDENTS_REPOSITORY = Symbol('STUDENTS_REPOSITORY');
