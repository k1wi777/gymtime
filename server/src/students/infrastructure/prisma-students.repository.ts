import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  DuplicateDocumentError,
  type ConsentRecord,
  type NewStudent,
  type StudentFilter,
  type StudentPatch,
} from '../domain/student.js';
import type {
  AnonymizedValues,
  StudentsRepository,
} from '../domain/students.repository.js';
import { toStudent } from './student-mapper.js';

const UNIQUE_VIOLATION = 'P2002';
const NOT_FOUND = 'P2025';

@Injectable()
export class PrismaStudentsRepository implements StudentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewStudent) {
    try {
      return toStudent(
        await this.prisma.student.create({ data: toCreateData(data) }),
      );
    } catch (error) {
      if (isPrismaError(error, UNIQUE_VIOLATION)) {
        throw new DuplicateDocumentError();
      }
      throw error;
    }
  }

  async createMany(data: NewStudent[]) {
    try {
      const rows = await this.prisma.student.createManyAndReturn({
        data: data.map(toCreateData),
      });
      return rows.map(toStudent);
    } catch (error) {
      if (isPrismaError(error, UNIQUE_VIOLATION)) {
        throw new DuplicateDocumentError();
      }
      throw error;
    }
  }

  async findById(id: string) {
    const row = await this.prisma.student.findUnique({ where: { id } });
    return row && toStudent(row);
  }

  async findByIds(ids: string[]) {
    const rows = await this.prisma.student.findMany({
      where: { id: { in: ids } },
    });
    return rows.map(toStudent);
  }

  async findByDocuments(documents: string[]) {
    if (documents.length === 0) return [];
    const rows = await this.prisma.student.findMany({
      where: { document: { in: documents } },
    });
    return rows.map(toStudent);
  }

  async findAll(filter: StudentFilter) {
    const search = filter.search?.trim();
    const rows = await this.prisma.student.findMany({
      where: {
        ...(filter.active !== undefined && { active: filter.active }),
        ...(filter.program !== undefined && { program: filter.program }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { document: { contains: search } },
          ],
        }),
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(toStudent);
  }

  update(id: string, patch: StudentPatch) {
    return this.updateOrNull(id, patch);
  }

  deactivate(id: string) {
    return this.updateOrNull(id, { active: false });
  }

  anonymize(id: string, values: AnonymizedValues, at: Date) {
    return this.updateOrNull(id, {
      ...values,
      program: null,
      email: null,
      phone: null,
      active: false,
      anonymizedAt: at,
    });
  }

  recordConsent(id: string, consent: ConsentRecord) {
    return this.updateOrNull(id, {
      consentVersion: consent.version,
      consentAt: consent.at,
      consentBy: consent.by,
    });
  }

  private async updateOrNull(
    id: string,
    data: Prisma.StudentUpdateInput | Prisma.StudentUncheckedUpdateInput,
  ) {
    try {
      return toStudent(
        await this.prisma.student.update({ where: { id }, data }),
      );
    } catch (error) {
      if (isPrismaError(error, NOT_FOUND)) return null;
      throw error;
    }
  }
}

function toCreateData({ consent, ...fields }: NewStudent) {
  return {
    ...fields,
    ...(consent && {
      consentVersion: consent.version,
      consentAt: consent.at,
      consentBy: consent.by,
    }),
  };
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
