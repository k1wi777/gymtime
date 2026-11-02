import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  SlotAssignment,
  SlotsRepository,
} from '../domain/slots.repository.js';

@Injectable()
export class PrismaSlotsRepository implements SlotsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async replace(deviceId: string, syncId: string, slots: SlotAssignment[]) {
    await this.prisma.$transaction([
      this.prisma.deviceSlot.deleteMany({ where: { deviceId } }),
      this.prisma.deviceSlot.createMany({
        data: slots.map(({ slot, fingerprintId }) => ({
          deviceId,
          slot,
          fingerprintId,
          syncId,
        })),
      }),
    ]);
  }

  async findByDevice(deviceId: string) {
    const rows = await this.prisma.deviceSlot.findMany({
      where: { deviceId },
      include: { fingerprint: { select: { studentId: true } } },
      orderBy: { slot: 'asc' },
    });
    return rows.flatMap((row) =>
      row.fingerprintId && row.fingerprint
        ? [
            {
              slot: row.slot,
              fingerprintId: row.fingerprintId,
              studentId: row.fingerprint.studentId,
            },
          ]
        : [],
    );
  }

  async findStudentIdBySlot(deviceId: string, slot: number) {
    const row = await this.prisma.deviceSlot.findUnique({
      where: { deviceId_slot: { deviceId, slot } },
      include: { fingerprint: { select: { studentId: true } } },
    });
    return row?.fingerprint?.studentId ?? null;
  }
}
