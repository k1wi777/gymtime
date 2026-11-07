import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  OfflineSnapshotRecord,
  OfflineSnapshotsRepository,
} from '../domain/offline-snapshots.repository.js';

@Injectable()
export class PrismaOfflineSnapshotsRepository implements OfflineSnapshotsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(snapshot: OfflineSnapshotRecord) {
    await this.prisma.offlineSnapshot.create({
      data: {
        id: snapshot.id,
        deviceId: snapshot.deviceId,
        scheduleId: snapshot.scheduleId,
        roster: snapshot.roster,
        createdAt: snapshot.createdAt,
      },
    });
  }

  async find(deviceId: string, id: string) {
    const row = await this.prisma.offlineSnapshot.findFirst({
      where: { id, deviceId },
    });
    if (!row) return null;
    return {
      id: row.id,
      deviceId: row.deviceId,
      scheduleId: row.scheduleId,
      roster: row.roster as Record<number, string>,
      createdAt: row.createdAt,
    };
  }

  async purgeOlderThan(date: Date) {
    const { count } = await this.prisma.offlineSnapshot.deleteMany({
      where: { createdAt: { lt: date } },
    });
    return count;
  }
}
