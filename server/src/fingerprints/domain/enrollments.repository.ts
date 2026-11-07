import type {
  Enrollment,
  EnrollmentChange,
  EnrollmentStatus,
  NewEnrollment,
} from './enrollment.js';

export interface EncryptedPayload {
  template: Buffer;
  iv: Buffer;
  keyVersion: number;
}

export interface EnrollmentsRepository {
  /** Creates it as `pending`. */
  create(data: NewEnrollment): Promise<Enrollment>;
  findById(id: string): Promise<Enrollment | null>;
  /** Enrollments in `pending` or `in_progress` on the device. */
  findOpenByDevice(deviceId: string): Promise<Enrollment[]>;
  findOpenByStudent(studentId: string): Promise<Enrollment[]>;
  /** Deletes every enrollment of the student (erasure); returns how many. */
  deleteByStudent(studentId: string): Promise<number>;
  /** Open enrollments whose expiry is at or before `now`. */
  findOverdue(now: Date): Promise<Enrollment[]>;
  /**
   * Compare-and-set: applies the change only if the current status is one of
   * `from`. Returns the updated enrollment, or null when nothing changed.
   */
  transition(
    id: string,
    from: readonly EnrollmentStatus[],
    change: EnrollmentChange,
  ): Promise<Enrollment | null>;
  /**
   * Atomically: the enrollment goes `in_progress` -> `done`, the previous
   * fingerprint of the student is deactivated and the new one becomes the
   * single active one. Returns null (and changes nothing) if the enrollment
   * is not `in_progress`.
   */
  completeWithFingerprint(
    id: string,
    fingerprint: EncryptedPayload,
  ): Promise<Enrollment | null>;
}

export const ENROLLMENTS_REPOSITORY = Symbol('ENROLLMENTS_REPOSITORY');
