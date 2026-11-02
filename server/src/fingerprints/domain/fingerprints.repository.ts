import type { Fingerprint } from './fingerprint.js';

export interface FingerprintsRepository {
  findActiveByStudent(studentId: string): Promise<Fingerprint | null>;
  findActiveByStudents(studentIds: string[]): Promise<Fingerprint[]>;
  /** Removes every fingerprint of the student; returns how many were removed. */
  deleteByStudent(studentId: string): Promise<number>;
}

export const FINGERPRINTS_REPOSITORY = Symbol('FINGERPRINTS_REPOSITORY');
