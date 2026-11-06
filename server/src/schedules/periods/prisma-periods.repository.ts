import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  NewPeriod,
  NewServiceException,
  Period,
  ServiceException,
} from './period.js';
import type { PeriodsRepository } from './periods.repository.js';

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

interface PeriodRow {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  active: boolean;
}

interface ExceptionRow {
  id: string;
  periodId: string;
  from: Date;
  to: Date;
  reason: string;
}

const toPeriod = (row: PeriodRow): Period => ({
  id: row.id,
  name: row.name,
  startDate: toDay(row.startDate),
  endDate: toDay(row.endDate),
  active: row.active,
});

const toException = (row: ExceptionRow): ServiceException => ({
  id: row.id,
  periodId: row.periodId,
  from: toDay(row.from),
  to: toDay(row.to),
  reason: row.reason,
});

const NOT_FOUND = 'P2025';
const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: string }).code === NOT_FOUND;

@Injectable()
export class PrismaPeriodsRepository implements PeriodsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewPeriod) {
    const row = await this.prisma.period.create({
      data: {
        name: data.name,
        startDate: toDate(data.startDate),
        endDate: toDate(data.endDate),
      },
    });
    return toPeriod(row);
  }

  async findById(id: string) {
    const row = await this.prisma.period.findUnique({ where: { id } });
    return row && toPeriod(row);
  }

  async findAll() {
    const rows = await this.prisma.period.findMany({
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toPeriod);
  }

  async findActive() {
    const row = await this.prisma.period.findFirst({ where: { active: true } });
    return row && toPeriod(row);
  }

  async update(id: string, patch: Partial<NewPeriod>) {
    try {
      const row = await this.prisma.period.update({
        where: { id },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.startDate !== undefined && {
            startDate: toDate(patch.startDate),
          }),
          ...(patch.endDate !== undefined && {
            endDate: toDate(patch.endDate),
          }),
        },
      });
      return toPeriod(row);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(id: string) {
    const { count } = await this.prisma.period.deleteMany({ where: { id } });
    return count > 0;
  }

  async activate(id: string) {
    // One transaction: the partial unique index allows a single active row.
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.period.findUnique({ where: { id } });
      if (!exists) return null;
      await tx.period.updateMany({
        where: { active: true, NOT: { id } },
        data: { active: false },
      });
      return toPeriod(
        await tx.period.update({ where: { id }, data: { active: true } }),
      );
    });
  }

  async deactivate(id: string) {
    try {
      const row = await this.prisma.period.update({
        where: { id },
        data: { active: false },
      });
      return toPeriod(row);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async listExceptions(periodId: string) {
    const rows = await this.prisma.serviceException.findMany({
      where: { periodId },
      orderBy: [{ from: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toException);
  }

  async listExceptionsOf(periodIds: string[]) {
    const result = new Map<string, ServiceException[]>(
      periodIds.map((id) => [id, []]),
    );
    const rows = await this.prisma.serviceException.findMany({
      where: { periodId: { in: periodIds } },
      orderBy: [{ from: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) result.get(row.periodId)?.push(toException(row));
    return result;
  }

  async findException(id: string) {
    const row = await this.prisma.serviceException.findUnique({
      where: { id },
    });
    return row && toException(row);
  }

  async addException(data: NewServiceException) {
    const row = await this.prisma.serviceException.create({
      data: {
        periodId: data.periodId,
        from: toDate(data.from),
        to: toDate(data.to),
        reason: data.reason,
      },
    });
    return toException(row);
  }

  async updateException(
    id: string,
    patch: Partial<Pick<ServiceException, 'from' | 'to' | 'reason'>>,
  ) {
    try {
      const row = await this.prisma.serviceException.update({
        where: { id },
        data: {
          ...(patch.from !== undefined && { from: toDate(patch.from) }),
          ...(patch.to !== undefined && { to: toDate(patch.to) }),
          ...(patch.reason !== undefined && { reason: patch.reason }),
        },
      });
      return toException(row);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async removeException(id: string) {
    const { count } = await this.prisma.serviceException.deleteMany({
      where: { id },
    });
    return count > 0;
  }
}
