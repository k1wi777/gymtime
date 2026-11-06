import { Inject, Injectable } from '@nestjs/common';
import {
  CsvError,
  STUDENT_FIELDS,
  buildCsv,
  checkStudentRow,
  parseCsv,
  suggestMapping,
  type ParsedCsv,
  type StudentFieldKey,
} from '@gymtime/shared';
import { currentActor } from '../../common/audit/actor.js';
import { EventLogService } from '../../common/audit/event-log.service.js';
import { DisplayValidationError } from '../../common/display/display.errors.js';
import { DuplicateDocumentError } from '../domain/student.js';
import { StudentsService } from '../students.service.js';
import {
  IMPORT_BATCHES_REPOSITORY,
  type ImportBatchesRepository,
} from './import-batches.repository.js';

/** Column index of the file for each field; null or missing = not in the file. */
export type ColumnMapping = Partial<Record<StudentFieldKey, number | null>>;

export interface RowError {
  field: StudentFieldKey | null;
  message: string;
}

export interface InvalidRow {
  /** Line of the file (the header is line 1). */
  row: number;
  errors: RowError[];
}

export interface Analysis {
  total: number;
  valid: number;
  invalidRows: InvalidRow[];
  /** Rows that pass every check, ready to create. */
  accepted: Array<Record<StudentFieldKey, string | null>>;
}

export interface PreviewResult {
  delimiter: ',' | ';';
  headers: string[];
  suggestedMapping: Record<StudentFieldKey, number | null>;
  sample: string[][];
  /** Present when a mapping was given. */
  validation?: Omit<Analysis, 'accepted'>;
}

export interface ImportResult {
  batchId: string;
  total: number;
  created: number;
  /** Returned once; never stored (it holds personal data). */
  invalidRows: InvalidRow[];
}

export type ImportErrorCode =
  'INVALID_CSV' | 'MAPPING_INCOMPLETE' | 'IMPORT_CONFLICT';

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const SAMPLE_ROWS = 20;
const REQUIRED = STUDENT_FIELDS.filter((f) => f.required);

/**
 * CSV import of students (E20-2, E20-3). Stateless: the preview and the import
 * both read the whole file and validate it with the shared field definitions;
 * the import never trusts a previous preview. Documents already in the
 * database or repeated in the file are row errors, never updates.
 */
@Injectable()
export class StudentImportService {
  constructor(
    private readonly students: StudentsService,
    @Inject(IMPORT_BATCHES_REPOSITORY)
    private readonly batches: ImportBatchesRepository,
    private readonly eventLog: EventLogService,
  ) {}

  /** Field definitions for the column-mapping screen and the forms. */
  fields() {
    return STUDENT_FIELDS.map(
      ({ key, label, required, editable, help, examples }) => ({
        key,
        label,
        required,
        editable,
        help: help ?? null,
        example: examples[0],
      }),
    );
  }

  /** Header and two sample rows: importing it as is produces no errors. */
  template(): string {
    return buildCsv([
      STUDENT_FIELDS.map((f) => f.label),
      STUDENT_FIELDS.map((f) => f.examples[0]),
      STUDENT_FIELDS.map((f) => f.examples[1]),
    ]);
  }

  /** @throws ImportError INVALID_CSV, MAPPING_INCOMPLETE */
  async preview(
    content: string,
    mapping?: ColumnMapping,
  ): Promise<PreviewResult> {
    const csv = this.read(content);
    const base: PreviewResult = {
      delimiter: csv.delimiter,
      headers: csv.headers,
      suggestedMapping: suggestMapping(csv.headers),
      sample: csv.rows.slice(0, SAMPLE_ROWS),
    };
    if (!mapping) return base;
    const { accepted: _accepted, ...validation } = await this.analyze(
      csv,
      mapping,
    );
    return { ...base, validation };
  }

  /**
   * Creates the valid rows and records the batch.
   * @throws ImportError INVALID_CSV, MAPPING_INCOMPLETE, IMPORT_CONFLICT
   */
  async import(
    content: string,
    mapping: ColumnMapping,
    filename: string,
  ): Promise<ImportResult> {
    const csv = this.read(content);
    const analysis = await this.analyze(csv, mapping);
    const actor = currentActor();
    const batch = await this.batches.create({
      filename,
      userId: actor.type === 'user' ? actor.id : null,
      total: analysis.total,
      valid: analysis.valid,
      errors: analysis.invalidRows.length,
    });
    try {
      if (analysis.accepted.length > 0) {
        await this.students.createMany(
          analysis.accepted.map((row) => ({
            document: row.document as string,
            name: row.name as string,
            program: row.program,
            email: row.email,
            phone: row.phone,
            ...(row.displayName && { displayName: row.displayName }),
          })),
          batch.id,
        );
      }
    } catch (error) {
      await this.batches.delete(batch.id);
      if (error instanceof DuplicateDocumentError) {
        throw new ImportError(
          'IMPORT_CONFLICT',
          'Otro usuario creó estudiantes con documentos del archivo; vuelva a revisar la vista previa',
        );
      }
      throw error;
    }
    // Counts only: documents and names are personal data.
    await this.eventLog.record('students.imported', {
      batchId: batch.id,
      total: analysis.total,
      valid: analysis.valid,
      errors: analysis.invalidRows.length,
    });
    return {
      batchId: batch.id,
      total: analysis.total,
      created: analysis.accepted.length,
      invalidRows: analysis.invalidRows,
    };
  }

  private read(content: string): ParsedCsv {
    try {
      return parseCsv(content);
    } catch (error) {
      if (error instanceof CsvError) {
        throw new ImportError('INVALID_CSV', error.message);
      }
      throw error;
    }
  }

  private async analyze(
    csv: ParsedCsv,
    mapping: ColumnMapping,
  ): Promise<Analysis> {
    const missing = REQUIRED.filter((f) => mapping[f.key] == null);
    if (missing.length > 0) {
      throw new ImportError(
        'MAPPING_INCOMPLETE',
        `Asigne una columna a: ${missing.map((f) => f.label).join(', ')}`,
      );
    }
    const used = Object.values(mapping).filter((i) => i != null);
    if (used.some((i) => i >= csv.headers.length)) {
      throw new ImportError(
        'MAPPING_INCOMPLETE',
        'La asignación usa una columna que no existe en el archivo',
      );
    }
    const errorsByRow = new Map<number, RowError[]>();
    const addError = (row: number, error: RowError) =>
      errorsByRow.set(row, [...(errorsByRow.get(row) ?? []), error]);
    const checked = csv.rows.map((cells, index) => {
      const row = index + 2;
      const raw = Object.fromEntries(
        STUDENT_FIELDS.map((f) => {
          const column = mapping[f.key];
          return [f.key, column == null ? '' : (cells[column] ?? '')];
        }),
      );
      const result = checkStudentRow(raw);
      if (!result.ok) {
        for (const issue of result.issues) addError(row, issue);
        return { row, values: null };
      }
      const display = this.checkDisplayName(result.values.displayName);
      if (display.error) addError(row, display.error);
      else result.values.displayName = display.value;
      return { row, values: display.error ? null : result.values };
    });
    await this.flagDuplicates(checked, addError);
    const accepted = checked.flatMap((c) =>
      c.values && !errorsByRow.has(c.row) ? [c.values] : [],
    );
    return {
      total: csv.rows.length,
      valid: accepted.length,
      invalidRows: [...errorsByRow.entries()]
        .sort(([a], [b]) => a - b)
        .map(([row, errors]) => ({ row, errors })),
      accepted,
    };
  }

  /** A display name that does not fit the screen is a row error, not a silent cut. */
  private checkDisplayName(value: string | null): {
    value: string | null;
    error?: RowError;
  } {
    if (value === null) return { value };
    try {
      return { value: this.students.validateDisplayName(value) };
    } catch (error) {
      if (error instanceof DisplayValidationError) {
        return {
          value,
          error: {
            field: 'displayName',
            message: error.errors[0]?.message ?? 'No cabe en la pantalla',
          },
        };
      }
      throw error;
    }
  }

  private async flagDuplicates(
    rows: Array<{
      row: number;
      values: Record<StudentFieldKey, string | null> | null;
    }>,
    addError: (row: number, error: RowError) => void,
  ): Promise<void> {
    const firstSeen = new Map<string, number>();
    for (const { row, values } of rows) {
      const document = values?.document;
      if (!document) continue;
      const first = firstSeen.get(document);
      if (first === undefined) firstSeen.set(document, row);
      else {
        addError(row, {
          field: 'document',
          message: `Documento repetido en el archivo (ya aparece en la fila ${first})`,
        });
      }
    }
    const existing = new Set(
      (await this.students.findByDocuments([...firstSeen.keys()])).map(
        (s) => s.document,
      ),
    );
    for (const [document, row] of firstSeen) {
      if (existing.has(document)) {
        addError(row, {
          field: 'document',
          message: 'Ya existe un estudiante con este documento',
        });
      }
    }
  }
}
