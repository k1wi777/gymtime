import { randomUUID } from 'node:crypto';
import type { Fingerprint } from '../domain/fingerprint.js';
import type {
  CipherUpdate,
  FingerprintsRepository,
} from '../domain/fingerprints.repository.js';

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

  async countByKeyVersion() {
    const counts = new Map<number, number>();
    for (const row of this.rows) {
      counts.set(row.keyVersion, (counts.get(row.keyVersion) ?? 0) + 1);
    }
    return counts;
  }

  async listNotInKeyVersion(version: number, limit: number) {
    return this.sorted()
      .filter((f) => f.keyVersion !== version)
      .slice(0, limit)
      .map((f) => ({ ...f }));
  }

  async listAfter(afterId: string | null, limit: number) {
    return this.sorted()
      .filter((f) => afterId === null || f.id > afterId)
      .slice(0, limit)
      .map((f) => ({ ...f }));
  }

  async replaceCiphertexts(updates: CipherUpdate[]) {
    let updated = 0;
    for (const u of updates) {
      const row = this.rows.find(
        (f) => f.id === u.id && f.keyVersion === u.fromVersion,
      );
      if (!row) continue;
      row.template = u.template;
      row.iv = u.iv;
      row.keyVersion = u.keyVersion;
      updated++;
    }
    return updated;
  }

  /** Every stored row, active or not (test visibility of the invariant). */
  all(): readonly Fingerprint[] {
    return this.rows;
  }

  /** Erases every previous row of the student and stores the new active one. */
  replaceActive(
    studentId: string,
    template: Buffer,
    iv: Buffer,
    keyVersion = 1,
  ): Fingerprint {
    this.deleteRows(studentId);
    const fingerprint: Fingerprint = {
      id: randomUUID(),
      studentId,
      template,
      iv,
      keyVersion,
      active: true,
      createdAt: new Date(),
    };
    this.rows.push(fingerprint);
    return fingerprint;
  }

  private sorted(): Fingerprint[] {
    return [...this.rows].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  private deleteRows(studentId: string): number {
    const kept = this.rows.filter((f) => f.studentId !== studentId);
    const removed = this.rows.length - kept.length;
    this.rows.splice(0, this.rows.length, ...kept);
    return removed;
  }
}
