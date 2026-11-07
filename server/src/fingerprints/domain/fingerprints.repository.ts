import type { Fingerprint } from './fingerprint.js';

export interface FingerprintsRepository {
  findActiveByStudent(studentId: string): Promise<Fingerprint | null>;
  findActiveByStudents(studentIds: string[]): Promise<Fingerprint[]>;
  /** Removes every fingerprint of the student; returns how many were removed. */
  deleteByStudent(studentId: string): Promise<number>;

  // Key rotation (H11). The key version is the progress marker of the rotation.
  /** Number of templates per key version. */
  countByKeyVersion(): Promise<Map<number, number>>;
  /** Up to `limit` templates NOT sealed with `version`, ordered by id. */
  listNotInKeyVersion(version: number, limit: number): Promise<Fingerprint[]>;
  /** Up to `limit` templates with id greater than `afterId`, ordered by id. */
  listAfter(afterId: string | null, limit: number): Promise<Fingerprint[]>;
  /**
   * Atomically replaces the ciphertext of each row, but only where the row is
   * still at `fromVersion` (a concurrent re-enrolment already uses the current
   * key and is not overwritten). Returns how many rows were updated.
   */
  replaceCiphertexts(updates: CipherUpdate[]): Promise<number>;
}

export interface CipherUpdate {
  id: string;
  fromVersion: number;
  template: Buffer;
  iv: Buffer;
  keyVersion: number;
}

export const FINGERPRINTS_REPOSITORY = Symbol('FINGERPRINTS_REPOSITORY');
