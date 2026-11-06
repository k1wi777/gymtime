/** One CSV import: only counts and the file name (the error report holds personal data). */
export interface ImportBatch {
  id: string;
  filename: string;
  /** Panel user who imported; null for the system key or a deleted account. */
  userId: string | null;
  createdAt: Date;
  total: number;
  valid: number;
  errors: number;
}

export type NewImportBatch = Omit<ImportBatch, 'id' | 'createdAt'>;

export interface ImportBatchesRepository {
  create(data: NewImportBatch): Promise<ImportBatch>;
  findById(id: string): Promise<ImportBatch | null>;
  /** Used to undo a batch whose students could not be created. */
  delete(id: string): Promise<void>;
}

export const IMPORT_BATCHES_REPOSITORY = Symbol('IMPORT_BATCHES_REPOSITORY');
