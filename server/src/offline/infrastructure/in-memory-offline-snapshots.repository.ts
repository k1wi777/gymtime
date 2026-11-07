import type {
  OfflineSnapshotRecord,
  OfflineSnapshotsRepository,
} from '../domain/offline-snapshots.repository.js';

export class InMemoryOfflineSnapshotsRepository implements OfflineSnapshotsRepository {
  private readonly rows = new Map<string, OfflineSnapshotRecord>();

  async save(snapshot: OfflineSnapshotRecord) {
    this.rows.set(snapshot.id, { ...snapshot, roster: { ...snapshot.roster } });
  }

  async find(deviceId: string, id: string) {
    const row = this.rows.get(id);
    return row?.deviceId === deviceId
      ? { ...row, roster: { ...row.roster } }
      : null;
  }

  async purgeOlderThan(date: Date) {
    let count = 0;
    for (const [id, row] of this.rows) {
      if (row.createdAt >= date) continue;
      this.rows.delete(id);
      count++;
    }
    return count;
  }
}
