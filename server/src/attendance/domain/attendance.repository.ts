import type {
  AttendanceSession,
  CloseAttendanceSession,
  NewAttendanceSession,
  SessionStatus,
} from './attendance-session.js';

export interface AttendanceFilter {
  studentId?: string;
  instanceId?: string;
  status?: SessionStatus;
  /** Inclusive lower bound of `enteredAt`. */
  from?: Date;
  /** Inclusive upper bound of `enteredAt`. */
  to?: Date;
  limit?: number;
}

export interface AttendanceRepository {
  create(data: NewAttendanceSession): Promise<AttendanceSession>;
  /**
   * Closes a session only while it is open; returns null when it does not
   * exist or was already closed, so repeated closes are no-ops.
   */
  close(
    id: string,
    data: CloseAttendanceSession,
  ): Promise<AttendanceSession | null>;
  findOpenByStudent(studentId: string): Promise<AttendanceSession | null>;
  /** Instances where the student already has a closed session. */
  listClosedInstanceIds(studentId: string): Promise<string[]>;
  countOpenByInstance(instanceId: string): Promise<number>;
  listOpenStudentIds(): Promise<string[]>;
  /** Sessions matching the filter, oldest entry first. */
  list(filter?: AttendanceFilter): Promise<AttendanceSession[]>;
}

export const ATTENDANCE_REPOSITORY = Symbol('ATTENDANCE_REPOSITORY');
