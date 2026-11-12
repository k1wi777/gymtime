import { STUDENT_FIELDS, parseCsv } from '@gymtime/shared';
import { runAsActor } from '../../common/audit/actor.js';
import { EventLogService } from '../../common/audit/event-log.service.js';
import { buildStudentsService } from '../testing.js';
import { InMemoryImportBatchesRepository } from './in-memory-import-batches.repository.js';
import { ImportError, StudentImportService } from './student-import.service.js';

function build() {
  const { service: students, eventLog } = buildStudentsService();
  const batches = new InMemoryImportBatchesRepository();
  const importer = new StudentImportService(
    students,
    batches,
    new EventLogService(eventLog),
  );
  return { importer, students, batches, eventLog };
}

const MAPPING = {
  document: 0,
  name: 1,
  program: 2,
  email: 3,
  phone: 4,
  displayName: 5,
};

const MIXED_CSV = [
  'Documento,Nombre,Carrera,Correo,Telefono,Nombre en pantalla',
  '1001,Ana Gomez,Ingenieria,ana@example.com,3001234567,',
  ',Sin documento,Medicina,,,',
  '1003,Luis Mora,,not-an-email,,',
  '1001,Ana Repetida,,,,',
  '1005,Pedro Largo,,,,Un nombre demasiado largo para la pantalla',
  '1006,Eva Ruiz,,,abc,',
  '1007,Maria Peña,Derecho,maria@example.com,,Ñandú',
  '1008,Emoji,,,,Hola\u0007',
].join('\n');

describe('StudentImportService (E20-2, E20-3)', () => {
  it('reports each bad row with its line and reason, and the preview stores nothing', async () => {
    const { importer, students, batches } = build();
    const preview = await importer.preview(MIXED_CSV, MAPPING);
    expect(preview.validation?.total).toBe(8);
    expect(preview.validation?.valid).toBe(2);
    const byRow = Object.fromEntries(
      preview.validation?.invalidRows.map((r) => [r.row, r.errors]) ?? [],
    );
    expect(byRow[3]).toEqual([
      { field: 'document', message: 'Es obligatorio' },
    ]);
    expect(byRow[4]?.[0]).toMatchObject({ field: 'email' });
    expect(byRow[5]?.[0]?.message).toMatch(/repetido en el archivo.*fila 2/);
    expect(byRow[6]?.[0]).toMatchObject({ field: 'displayName' });
    expect(byRow[7]?.[0]).toMatchObject({ field: 'phone' });
    expect(byRow[9]?.[0]).toMatchObject({ field: 'displayName' });
    expect(byRow[2]).toBeUndefined();
    expect(byRow[8]).toBeUndefined();
    expect(await students.list()).toEqual([]);
    expect(batches.rows.size).toBe(0);
  });

  it('suggests the mapping from the headers and shows a sample', async () => {
    const { importer } = build();
    const preview = await importer.preview('Cédula;Nombre;Carrera\n1;Ana;X\n');
    expect(preview.delimiter).toBe(';');
    expect(preview.suggestedMapping).toMatchObject({
      document: 0,
      name: 1,
      program: 2,
      email: null,
    });
    expect(preview.sample).toEqual([['1', 'Ana', 'X']]);
    expect(preview.validation).toBeUndefined();
  });

  it('imports only the valid rows, records the batch and leaves students without consent', async () => {
    const { importer, students, batches } = build();
    const result = await runAsActor({ type: 'user', id: 'u-admin' }, () =>
      importer.import(MIXED_CSV, MAPPING, 'lista.csv'),
    );
    expect(result.created).toBe(2);
    expect(result.invalidRows).toHaveLength(6);
    const created = await students.list();
    expect(created.map((s) => s.document).sort()).toEqual(['1001', '1007']);
    expect(created.every((s) => !s.consented && s.active)).toBe(true);
    // Accents are kept on the screen and a missing name is generated.
    const maria = created.find((s) => s.document === '1007');
    expect(maria?.displayName).toBe('Ñandú');
    expect(created.find((s) => s.document === '1001')?.displayName).toBe(
      'Ana Gomez',
    );
    expect(batches.rows.get(result.batchId)).toMatchObject({
      filename: 'lista.csv',
      userId: 'u-admin',
      total: 8,
      valid: 2,
      errors: 6,
    });
  });

  it('keeps the personal data of the report out of the batch and the audit', async () => {
    const { importer, batches, eventLog } = build();
    await importer.import(MIXED_CSV, MAPPING, 'lista.csv');
    const stored = JSON.stringify([...batches.rows.values()]);
    expect(stored).not.toMatch(/Ana|1001|example\.com/);
    const audit = eventLog.entries.filter(
      (e) => e.type === 'students.imported',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.detail).toMatchObject({ total: 8, valid: 2, errors: 6 });
    expect(JSON.stringify(eventLog.entries)).not.toMatch(
      /1001|1007|Ana|example\.com/,
    );
  });

  it('rejects an existing document as a row error and never overwrites it', async () => {
    const { importer, students } = build();
    await students.create({ document: '1', name: 'Original', program: null });
    const result = await importer.import(
      'Documento,Nombre\n1,Cambiado\n2,Nuevo\n',
      { document: 0, name: 1 },
      'a.csv',
    );
    expect(result.created).toBe(1);
    expect(result.invalidRows[0]).toMatchObject({
      row: 2,
      errors: [{ message: 'Ya existe un estudiante con este documento' }],
    });
    expect((await students.list()).find((s) => s.document === '1')?.name).toBe(
      'Original',
    );
  });

  it('revalidates in the import even if the preview was different', async () => {
    const { importer, students } = build();
    const csv = 'Documento,Nombre\n1,Ana\n2,Luis\n';
    await importer.preview(csv, { document: 0, name: 1 });
    await students.create({
      document: '2',
      name: 'Luis ya existe',
      program: null,
    });
    const result = await importer.import(
      csv,
      { document: 0, name: 1 },
      'a.csv',
    );
    expect(result.created).toBe(1);
    expect(result.invalidRows).toHaveLength(1);
  });

  it('demands a column for the required fields and rejects a broken file', async () => {
    const { importer } = build();
    await expect(
      importer.preview('a,b\n1,2\n', { name: 0 }),
    ).rejects.toMatchObject({ code: 'MAPPING_INCOMPLETE' });
    await expect(
      importer.preview('a,b\n1,2\n', { document: 0, name: 7 }),
    ).rejects.toMatchObject({ code: 'MAPPING_INCOMPLETE' });
    await expect(importer.preview('')).rejects.toBeInstanceOf(ImportError);
    await expect(importer.preview('a\n"open')).rejects.toMatchObject({
      code: 'INVALID_CSV',
    });
  });

  it('the downloadable template imports with zero errors', async () => {
    const { importer, students } = build();
    const template = importer.template();
    const csv = parseCsv(template);
    expect(csv.headers).toEqual(STUDENT_FIELDS.map((f) => f.label));
    const preview = await importer.preview(template);
    expect(preview.suggestedMapping).toEqual({
      document: 0,
      name: 1,
      program: 2,
      email: 3,
      phone: 4,
      displayName: 5,
    });
    const result = await importer.import(
      template,
      preview.suggestedMapping,
      'plantilla.csv',
    );
    expect(result).toMatchObject({ total: 2, created: 2, invalidRows: [] });
    expect(await students.list()).toHaveLength(2);
  });

  it('exposes the single field definition', () => {
    const { importer } = build();
    expect(importer.fields().map((f) => f.key)).toEqual(
      STUDENT_FIELDS.map((f) => f.key),
    );
    expect(importer.fields().find((f) => f.key === 'document')).toMatchObject({
      required: true,
      editable: false,
    });
  });
});
