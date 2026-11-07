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
  /**
   * Replaces every personal field by neutral values and marks the student
   * inactive and anonymised, in one write. Null when the student is missing.
   */
  anonymize(
    id: string,
    values: AnonymizedValues,
    at: Date,
  ): Promise<Student | null>;
  /** Stores the consent; returns null when the student does not exist. */
  recordConsent(id: string, consent: ConsentRecord): Promise<Student | null>;
}

/** What replaces the personal data of an erased student. */
export interface AnonymizedValues {
  name: string;
  document: string;
  displayName: string;
}

export const STUDENTS_REPOSITORY = Symbol('STUDENTS_REPOSITORY');
