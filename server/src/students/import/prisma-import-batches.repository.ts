import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  ImportBatch,
  ImportBatchesRepository,
  NewImportBatch,
} from './import-batches.repository.js';

type Row = {
  id: string;
  filename: string;
  userId: string | null;
  createdAt: Date;
  total: number;
  valid: number;
  errors: number;
};

const toDomain = (row: Row): ImportBatch => ({ ...row });

@Injectable()
export class PrismaImportBatchesRepository implements ImportBatchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewImportBatch) {
    return toDomain(await this.prisma.importBatch.create({ data }));
  }

  async findById(id: string) {
    const row = await this.prisma.importBatch.findUnique({ where: { id } });
    return row && toDomain(row);
  }

  async delete(id: string) {
    await this.prisma.importBatch.deleteMany({ where: { id } });
  }
}
