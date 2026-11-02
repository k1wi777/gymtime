import { randomUUID } from 'node:crypto';
import {
  isOpen,
  type Enrollment,
  type EnrollmentChange,
  type EnrollmentStatus,
  type NewEnrollment,
} from '../domain/enrollment.js';
import type {
  EncryptedPayload,
  EnrollmentsRepository,
} from '../domain/enrollments.repository.js';
import type { InMemoryFingerprintsRepository } from './in-memory-fingerprints.repository.js';

export class InMemoryEnrollmentsRepository implements EnrollmentsRepository {
  private readonly rows = new Map<string, Enrollment>();

  /** Shares the fingerprint store so completion is atomic, as in the database. */
  constructor(private readonly fingerprints: InMemoryFingerprintsRepository) {}

  async create(data: NewEnrollment) {
    const enrollment: Enrollment = {
      id: randomUUID(),
      status: 'pending',
      step: null,
      failureReason: null,
      ...data,
    };
    this.rows.set(enrollment.id, enrollment);
    return { ...enrollment };
  }

  async findById(id: string) {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async findOpenByDevice(deviceId: string) {
    return this.open((e) => e.deviceId === deviceId);
  }

  async findOpenByStudent(studentId: string) {
    return this.open((e) => e.studentId === studentId);
  }

  async findOverdue(now: Date) {
    return this.open((e) => e.expiresAt.getTime() <= now.getTime());
  }

  async transition(
    id: string,
    from: readonly EnrollmentStatus[],
    change: EnrollmentChange,
  ) {
    return this.apply(id, from, change);
  }

  async completeWithFingerprint(id: string, fingerprint: EncryptedPayload) {
    const current = this.rows.get(id);
    if (current?.status !== 'in_progress') return null;
    this.fingerprints.replaceActive(
      current.studentId,
      fingerprint.template,
      fingerprint.iv,
    );
    return this.apply(id, ['in_progress'], { status: 'done' });
  }

  private apply(
    id: string,
    from: readonly EnrollmentStatus[],
    change: EnrollmentChange,
  ) {
    const current = this.rows.get(id);
    if (!current || !from.includes(current.status)) return null;
    const updated: Enrollment = {
      ...current,
      status: change.status,
      step: change.step === undefined ? current.step : change.step,
      failureReason:
        change.failureReason === undefined
          ? current.failureReason
          : change.failureReason,
    };
    this.rows.set(id, updated);
    return { ...updated };
  }

  private open(predicate: (e: Enrollment) => boolean) {
    return [...this.rows.values()]
      .filter((e) => isOpen(e.status) && predicate(e))
      .map((e) => ({ ...e }));
  }
}
