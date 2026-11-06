import type {
  ConsentRecord,
  NewStudent,
  Student,
  StudentFilter,
  StudentPatch,
} from './student.js';

export interface StudentsRepository {
  /** @throws DuplicateDocumentError when the document already exists. */
  create(data: NewStudent): Promise<Student>;
  /**
   * All or none: used by the CSV import.
   * @throws DuplicateDocumentError when any document already exists.
   */
  createMany(data: NewStudent[]): Promise<Student[]>;
  findById(id: string): Promise<Student | null>;
  findByIds(ids: string[]): Promise<Student[]>;
  /** Students with those documents (exact match), any state. */
  findByDocuments(documents: string[]): Promise<Student[]>;
  /** Ordered by name. */
  findAll(filter: StudentFilter): Promise<Student[]>;
  /** Returns null when the student does not exist. */
  update(id: string, patch: StudentPatch): Promise<Student | null>;
  /** Marks the student inactive; returns null when it does not exist. */
  deactivate(id: string): Promise<Student | null>;
  /** Stores the consent; returns null when the student does not exist. */
  recordConsent(id: string, consent: ConsentRecord): Promise<Student | null>;
}

export const STUDENTS_REPOSITORY = Symbol('STUDENTS_REPOSITORY');
