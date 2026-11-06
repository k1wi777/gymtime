import type {
  AttendanceSession,
  AttendanceSource,
  CloseAttendanceSession,
  NewAttendanceSession,
  SessionStatus,
} from './attendance-session.js';

export interface AttendanceFilter {
  studentId?: string;
  /** Any of these students (e.g. the result of a name search). */
  studentIds?: string[];
  instanceId?: string;
  /** Any of these occurrences (e.g. all those of a schedule). */
  instanceIds?: string[];
  /** `entrySource` or `exitSource` equals this. */
  source?: AttendanceSource;
  status?: SessionStatus;
  /** Inclusive lower bound of `enteredAt`. */
  from?: Date;
  /** Inclusive upper bound of `enteredAt`. */
  to?: Date;
  limit?: number;
  offset?: number;
  /** Default `asc` (oldest entry first). */
  order?: 'asc' | 'desc';
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
  /**
   * Closes every open session of an occurrence as `no_registrada` without an
   * exit time, storing the reason; returns how many were closed.
   */
  closeOpenByInstance(
    instanceId: string,
    data: { manualReason: string },
  ): Promise<number>;
  listOpenStudentIds(): Promise<string[]>;
  /** Sessions matching the filter (oldest entry first unless `order` says otherwise). */
  list(filter?: AttendanceFilter): Promise<AttendanceSession[]>;
  /** How many sessions match the filter, ignoring `limit`, `offset` and `order`. */
  count(filter?: AttendanceFilter): Promise<number>;
}

export const ATTENDANCE_REPOSITORY = Symbol('ATTENDANCE_REPOSITORY');
