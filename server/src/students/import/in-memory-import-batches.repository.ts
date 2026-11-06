import { randomUUID } from 'node:crypto';
import type {
  ImportBatch,
  ImportBatchesRepository,
  NewImportBatch,
} from './import-batches.repository.js';

export class InMemoryImportBatchesRepository implements ImportBatchesRepository {
  readonly rows = new Map<string, ImportBatch>();

  async create(data: NewImportBatch) {
    const batch: ImportBatch = {
      id: randomUUID(),
      createdAt: new Date(),
      ...data,
    };
    this.rows.set(batch.id, batch);
    return { ...batch };
  }

  async findById(id: string) {
    const batch = this.rows.get(id);
    return batch ? { ...batch } : null;
  }

  async delete(id: string) {
    this.rows.delete(id);
  }
}
