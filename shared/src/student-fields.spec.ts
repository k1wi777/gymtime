import {
  STUDENT_FIELDS,
  checkStudentRow,
  studentFieldSchemas,
  suggestMapping,
} from './student-fields.js';

describe('STUDENT_FIELDS', () => {
  it('has a schema for every field and no schema without a field', () => {
    expect(STUDENT_FIELDS.map((f) => f.key).sort()).toEqual(
      Object.keys(studentFieldSchemas).sort(),
    );
  });

  it('suggests columns by alias, ignoring accents and case', () => {
    expect(
      suggestMapping(['Cédula', 'NOMBRE', 'Carrera', 'Teléfono', 'otro']),
    ).toEqual({
      document: 0,
      name: 1,
      program: 2,
      email: null,
      phone: 3,
      displayName: null,
    });
  });
});

describe('checkStudentRow', () => {
  it('normalizes a valid row and turns blank optionals into null', () => {
    expect(
      checkStudentRow({
        document: ' 1001 ',
        name: 'Ana',
        email: 'ANA@Example.com',
        program: '',
      }),
    ).toEqual({
      ok: true,
      values: {
        document: '1001',
        name: 'Ana',
        program: null,
        email: 'ana@example.com',
        phone: null,
        displayName: null,
      },
    });
  });

  it('reports every field with its reason', () => {
    const result = checkStudentRow({
      document: '',
      name: 'Ana',
      email: 'not-an-email',
      phone: 'abc',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.field)).toEqual([
      'document',
      'email',
      'phone',
    ]);
    expect(result.issues[0]?.message).toBe('Es obligatorio');
  });
});
