import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Fingerprint } from '../domain/fingerprint.js';
import type {
  CipherUpdate,
  FingerprintsRepository,
} from '../domain/fingerprints.repository.js';

const toDomain = (row: {
  id: string;
  studentId: string;
  template: Uint8Array;
  iv: Uint8Array;
  active: boolean;
  keyVersion: number;
  createdAt: Date;
}): Fingerprint => ({
  ...row,
  template: Buffer.from(row.template),
  iv: Buffer.from(row.iv),
});

@Injectable()
export class PrismaFingerprintsRepository implements FingerprintsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByStudent(studentId: string) {
    const row = await this.prisma.fingerprint.findFirst({
      where: { studentId, active: true },
    });
    return row && toDomain(row);
  }

  async findActiveByStudents(studentIds: string[]) {
    const rows = await this.prisma.fingerprint.findMany({
      where: { studentId: { in: studentIds }, active: true },
    });
    return rows.map(toDomain);
  }

  async countByKeyVersion() {
    const groups = await this.prisma.fingerprint.groupBy({
      by: ['keyVersion'],
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.keyVersion, g._count._all]));
  }

  async listNotInKeyVersion(version: number, limit: number) {
    const rows = await this.prisma.fingerprint.findMany({
      where: { keyVersion: { not: version } },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async listAfter(afterId: string | null, limit: number) {
    const rows = await this.prisma.fingerprint.findMany({
      where: afterId ? { id: { gt: afterId } } : {},
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async replaceCiphertexts(updates: CipherUpdate[]) {
    if (updates.length === 0) return 0;
    const results = await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.fingerprint.updateMany({
          where: { id: u.id, keyVersion: u.fromVersion },
          data: {
            template: new Uint8Array(u.template),
            iv: new Uint8Array(u.iv),
            keyVersion: u.keyVersion,
          },
        }),
      ),
    );
    return results.reduce((sum, r) => sum + r.count, 0);
  }

  async deleteByStudent(studentId: string) {
    const { count } = await this.prisma.fingerprint.deleteMany({
      where: { studentId },
    });
    return count;
  }
}
