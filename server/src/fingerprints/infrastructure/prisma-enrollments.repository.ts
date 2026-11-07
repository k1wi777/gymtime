import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  OPEN_STATUSES,
  type EnrollmentChange,
  type EnrollmentStatus,
  type NewEnrollment,
} from '../domain/enrollment.js';
import type {
  EncryptedPayload,
  EnrollmentsRepository,
} from '../domain/enrollments.repository.js';

const open = { in: [...OPEN_STATUSES] };

@Injectable()
export class PrismaEnrollmentsRepository implements EnrollmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: NewEnrollment) {
    return this.prisma.enrollment.create({ data });
  }

  findById(id: string) {
    return this.prisma.enrollment.findUnique({ where: { id } });
  }

  findOpenByDevice(deviceId: string) {
    return this.prisma.enrollment.findMany({
      where: { deviceId, status: open },
    });
  }

  findOpenByStudent(studentId: string) {
    return this.prisma.enrollment.findMany({
      where: { studentId, status: open },
    });
  }

  async deleteByStudent(studentId: string) {
    const { count } = await this.prisma.enrollment.deleteMany({
      where: { studentId },
    });
    return count;
  }

  findOverdue(now: Date) {
    return this.prisma.enrollment.findMany({
      where: { status: open, expiresAt: { lte: now } },
    });
  }

  async transition(
    id: string,
    from: readonly EnrollmentStatus[],
    change: EnrollmentChange,
  ) {
    const { count } = await this.prisma.enrollment.updateMany({
      where: { id, status: { in: [...from] } },
      data: change,
    });
    return count === 0 ? null : this.findById(id);
  }

  completeWithFingerprint(id: string, fingerprint: EncryptedPayload) {
    return this.prisma.$transaction(async (tx) => {
      // The status guard makes a late or repeated done a no-op.
      const { count } = await tx.enrollment.updateMany({
        where: { id, status: 'in_progress' },
        data: { status: 'done' },
      });
      if (count === 0) return null;
      const enrollment = await tx.enrollment.findUniqueOrThrow({
        where: { id },
      });
      // Data minimisation (Ley 1581): the previous template is erased, not
      // kept inactive. By studentId so legacy inactive rows go too.
      await tx.fingerprint.deleteMany({
        where: { studentId: enrollment.studentId },
      });
      await tx.fingerprint.create({
        data: {
          studentId: enrollment.studentId,
          template: new Uint8Array(fingerprint.template),
          iv: new Uint8Array(fingerprint.iv),
          keyVersion: fingerprint.keyVersion,
        },
      });
      return enrollment;
    });
  }
}
