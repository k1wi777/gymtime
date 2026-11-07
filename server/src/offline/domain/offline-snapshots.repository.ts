export interface OfflineSnapshotRecord {
  id: string;
  deviceId: string;
  scheduleId: string | null;
  /** Slot -> internal student id (no names, no biometrics). */
  roster: Record<number, string>;
  createdAt: Date;
}

export interface OfflineSnapshotsRepository {
  save(snapshot: OfflineSnapshotRecord): Promise<void>;
  /** Only a snapshot that was sent to that device. */
  find(deviceId: string, id: string): Promise<OfflineSnapshotRecord | null>;
  /** Deletes snapshots created before the date; returns how many. */
  purgeOlderThan(date: Date): Promise<number>;
}

export const OFFLINE_SNAPSHOTS_REPOSITORY = Symbol(
  'OFFLINE_SNAPSHOTS_REPOSITORY',
);
