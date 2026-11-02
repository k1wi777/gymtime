export const ENROLLMENT_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'failed',
  'expired',
  'cancelled',
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** States in which the reader's single work slot is busy. */
export const OPEN_STATUSES = ['pending', 'in_progress'] as const;

export interface Enrollment {
  id: string;
  studentId: string;
  deviceId: string;
  status: EnrollmentStatus;
  expiresAt: Date;
  /** Last `enroll.progress` step reported by the device. */
  step: string | null;
  /** Reason of a failure reported by the device or found by validation. */
  failureReason: string | null;
}

export interface NewEnrollment {
  studentId: string;
  deviceId: string;
  expiresAt: Date;
}

export interface EnrollmentChange {
  status: EnrollmentStatus;
  step?: string | null;
  failureReason?: string | null;
}

export function isOpen(status: EnrollmentStatus): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}
