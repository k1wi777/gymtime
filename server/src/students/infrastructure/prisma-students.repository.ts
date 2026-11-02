import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  DuplicateDocumentError,
  type NewStudent,
  type StudentPatch,
} from '../domain/student.js';
import type { StudentsRepository } from '../domain/students.repository.js';

const UNIQUE_VIOLATION = 'P2002';
const NOT_FOUND = 'P2025';

@Injectable()
export class PrismaStudentsRepository implements StudentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewStudent) {
    try {
      return await this.prisma.student.create({ data });
    } catch (error) {
      if (isPrismaError(error, UNIQUE_VIOLATION)) {
        throw new DuplicateDocumentError();
      }
      throw error;
    }
  }

  findById(id: string) {
    return this.prisma.student.findUnique({ where: { id } });
  }

  findByIds(ids: string[]) {
    return this.prisma.student.findMany({ where: { id: { in: ids } } });
  }

  findAll(filter: { active?: boolean }) {
    return this.prisma.student.findMany({
      where: filter.active === undefined ? {} : { active: filter.active },
      orderBy: { name: 'asc' },
    });
  }

  update(id: string, patch: StudentPatch) {
    return this.updateOrNull(id, patch);
  }

  deactivate(id: string) {
    return this.updateOrNull(id, { active: false });
  }

  private async updateOrNull(
    id: string,
    data: StudentPatch | { active: boolean },
  ) {
    try {
      return await this.prisma.student.update({ where: { id }, data });
    } catch (error) {
      if (isPrismaError(error, NOT_FOUND)) return null;
      throw error;
    }
  }
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
