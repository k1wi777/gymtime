import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { FingerprintsRepository } from '../domain/fingerprints.repository.js';

@Injectable()
export class PrismaFingerprintsRepository implements FingerprintsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByStudent(studentId: string) {
    const row = await this.prisma.fingerprint.findFirst({
      where: { studentId, active: true },
    });
    return (
      row && {
        ...row,
        template: Buffer.from(row.template),
        iv: Buffer.from(row.iv),
      }
    );
  }

  async deleteByStudent(studentId: string) {
    const { count } = await this.prisma.fingerprint.deleteMany({
      where: { studentId },
    });
    return count;
  }
}
