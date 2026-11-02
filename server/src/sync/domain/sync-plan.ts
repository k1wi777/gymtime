export interface PlannedSlot {
  slot: number;
  fingerprintId: string;
  studentId: string;
}

export interface PlannedSchedule {
  scheduleId: string;
  startsAt: Date;
  endsAt: Date;
  entryOpensAt: Date;
  entryClosesAt: Date;
}

/**
 * What a sync will load. `templates[i]` belongs to `slots[i]`; the decrypted
 * bytes live only in this object, during the send: never log or serialize it.
 */
export interface SyncPlan {
  slots: PlannedSlot[];
  templates: Buffer[];
  /** Syncable students left out because the reader has no slot for them. */
  omitted: number;
  /** Students ignored because they have no active fingerprint or are inactive. */
  skippedStudentIds: string[];
  schedule: PlannedSchedule | null;
}
