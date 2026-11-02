/** State of one attendance session; matches the `session_status` enum. */
export type SessionStatus = 'abierta' | 'cerrada' | 'no_registrada';

/** Where an entry or exit came from; matches the `attendance_source` enum. */
export type AttendanceSource = 'device' | 'manual';

export interface AttendanceSession {
  id: string;
  studentId: string;
  instanceId: string;
  enteredAt: Date;
  exitedAt: Date | null;
  entrySource: AttendanceSource;
  exitSource: AttendanceSource | null;
  status: SessionStatus;
  manualReason: string | null;
}

export interface NewAttendanceSession {
  studentId: string;
  instanceId: string;
  enteredAt: Date;
  entrySource: AttendanceSource;
  manualReason?: string | null;
}

export interface CloseAttendanceSession {
  exitedAt: Date;
  exitSource: AttendanceSource;
  manualReason?: string | null;
}
