import { randomUUID } from 'node:crypto';
import type { Fingerprint } from '../domain/fingerprint.js';
import type { FingerprintsRepository } from '../domain/fingerprints.repository.js';

export class InMemoryFingerprintsRepository implements FingerprintsRepository {
  private readonly rows: Fingerprint[] = [];

  async findActiveByStudent(studentId: string) {
    return this.rows.find((f) => f.studentId === studentId && f.active) ?? null;
  }

  async findActiveByStudents(studentIds: string[]) {
    return this.rows.filter(
      (f) => f.active && studentIds.includes(f.studentId),
    );
  }

  async deleteByStudent(studentId: string) {
    return this.deleteRows(studentId);
  }

  /** Every stored row, active or not (test visibility of the invariant). */
  all(): readonly Fingerprint[] {
    return this.rows;
  }

  /** Erases every previous row of the student and stores the new active one. */
  replaceActive(studentId: string, template: Buffer, iv: Buffer): Fingerprint {
    this.deleteRows(studentId);
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

  private deleteRows(studentId: string): number {
    const kept = this.rows.filter((f) => f.studentId !== studentId);
    const removed = this.rows.length - kept.length;
    this.rows.splice(0, this.rows.length, ...kept);
    return removed;
  }
}
