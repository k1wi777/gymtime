import { STUDENT_FIELDS } from '@gymtime/shared';
import { createStudentSchema, updateStudentSchema } from './dto/student.dto.js';
import { InMemoryImportBatchesRepository } from './import/in-memory-import-batches.repository.js';
import { StudentImportService } from './import/student-import.service.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { buildStudentsService } from './testing.js';

/**
 * E20-7: the field list is defined once. If a field is added or removed in
 * `STUDENT_FIELDS` and one consumer is not updated, this test fails.
 */
describe('single definition of the student fields (E20-7)', () => {
  const { service, eventLog } = buildStudentsService();
  const importer = new StudentImportService(
    service,
    new InMemoryImportBatchesRepository(),
    new EventLogService(eventLog),
  );

  it('every field is accepted by the create DTO, and by the edit DTO unless it is the document', () => {
    const create = Object.keys(createStudentSchema.shape);
    const update = Object.keys(updateStudentSchema.shape);
    for (const field of STUDENT_FIELDS) {
      expect(create, `create DTO lacks ${field.key}`).toContain(field.key);
      if (field.editable) {
        expect(update, `edit DTO lacks ${field.key}`).toContain(field.key);
      } else {
        expect(update).not.toContain(field.key);
      }
    }
  });

  it('every field is in the template header, the field list endpoint and the student returned', async () => {
    const header = importer.template().split('\r\n')[0]?.split(',') ?? [];
    expect(header).toEqual(STUDENT_FIELDS.map((f) => f.label));
    expect(importer.fields().map((f) => f.key)).toEqual(
      STUDENT_FIELDS.map((f) => f.key),
    );
    const student = await service.create({
      document: '1',
      name: 'Ana',
      program: 'X',
      email: 'a@example.com',
      phone: '300',
      displayName: 'Ana',
    });
    for (const field of STUDENT_FIELDS) {
      expect(Object.keys(student), `student lacks ${field.key}`).toContain(
        field.key,
      );
    }
  });

  it('the required fields of the definition are required by the create DTO', () => {
    const required = STUDENT_FIELDS.filter((f) => f.required).map((f) => f.key);
    const result = createStudentSchema.safeParse({});
    const missing = result.success
      ? []
      : result.error.issues.map((issue) => issue.path[0]);
    expect([...missing].sort()).toEqual([...required].sort());
  });
});
