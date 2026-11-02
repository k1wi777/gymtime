export type EnrollmentErrorCode =
  | 'STUDENT_NOT_FOUND'
  | 'STUDENT_INACTIVE'
  | 'DEVICE_UNAVAILABLE'
  | 'DEVICE_BUSY'
  | 'ENROLLMENT_NOT_FOUND'
  | 'ENROLLMENT_FINISHED';

/** Business-rule failure; the controller maps `code` to an HTTP status. */
export class EnrollmentError extends Error {
  constructor(
    readonly code: EnrollmentErrorCode,
    message: string,
  ) {
    super(message);
  }
}
