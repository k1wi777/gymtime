import { randomUUID } from 'node:crypto';
import type { Fingerprint } from '../domain/fingerprint.js';
import type { FingerprintsRepository } from '../domain/fingerprints.repository.js';

export class InMemoryFingerprintsRepository implements FingerprintsRepository {
  private readonly rows: Fingerprint[] = [];

  async findActiveByStudent(studentId: string) {
    return this.rows.find((f) => f.studentId === studentId && f.active) ?? null;
  }

  async deleteByStudent(studentId: string) {
    const kept = this.rows.filter((f) => f.studentId !== studentId);
    const removed = this.rows.length - kept.length;
    this.rows.splice(0, this.rows.length, ...kept);
    return removed;
  }

  /** Every stored row, active or not (test visibility of the invariant). */
  all(): readonly Fingerprint[] {
    return this.rows;
  }

  /** Deactivates the previous fingerprint and stores the new active one. */
  replaceActive(studentId: string, template: Buffer, iv: Buffer): Fingerprint {
    this.rows.forEach((f, i) => {
      if (f.studentId === studentId && f.active) {
        this.rows[i] = { ...f, active: false };
      }
    });
    const fingerprint: Fingerprint = {
      id: randomUUID(),
      studentId,
      template,
      iv,
      active: true,
      createdAt: new Date(),
    };
    this.rows.push(fingerprint);
    return fingerprint;
  }
}
