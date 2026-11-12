import { z } from 'zod';

/**
 * The student fields live here and nowhere else (H9, E20-7): the REST DTOs,
 * the CSV importer, the column mapping, the CSV template and the panel forms
 * all derive from this list. Adding or removing a field is done in this file.
 *
 * The messages are in Spanish because the import report shows them as they are.
 */
const MAX_TEXT = 200;
const MAX_EMAIL = 254;
const MAX_PHONE = 20;
/** Loose bound; the exact limit (DISPLAY_NAME_MAX) is enforced by the server. */
const MAX_DISPLAY_NAME = 40;

const text = z
  .string('Debe ser un texto')
  .trim()
  .min(1, 'Es obligatorio')
  .max(MAX_TEXT, `Admite hasta ${MAX_TEXT} caracteres`);

const email = z
  .string('Debe ser un texto')
  .trim()
  .toLowerCase()
  .max(MAX_EMAIL, `Admite hasta ${MAX_EMAIL} caracteres`)
  .pipe(z.email('El correo no tiene un formato válido'));

// Digits, spaces, "+", "-" and parentheses, with at least one digit.
const phone = z
  .string('Debe ser un texto')
  .trim()
  .max(MAX_PHONE, `Admite hasta ${MAX_PHONE} caracteres`)
  .regex(/^[0-9 +()-]+$/, 'Solo dígitos, espacios, +, - y paréntesis')
  .regex(/[0-9]/, 'Debe tener al menos un dígito');

const displayName = z
  .string('Debe ser un texto')
  .trim()
  .min(1, 'No puede estar vacío')
  .max(MAX_DISPLAY_NAME, `Admite hasta ${MAX_DISPLAY_NAME} caracteres`);

/** One schema per field, keyed like `STUDENT_FIELDS`. */
export const studentFieldSchemas = {
  document: text,
  name: text,
  program: text,
  email,
  phone,
  displayName,
} as const;

export type StudentFieldKey = keyof typeof studentFieldSchemas;

export interface StudentFieldDefinition {
  key: StudentFieldKey;
  /** Spanish label for forms, column mapping and the template header. */
  label: string;
  required: boolean;
  /** The document cannot be edited once the student exists. */
  editable: boolean;
  /** Lowercase, accent-free CSV header names that map to this field. */
  aliases: readonly string[];
  /** Cell of the two sample rows of the CSV template. */
  examples: readonly [string, string];
  help?: string;
}

export const STUDENT_FIELDS: readonly StudentFieldDefinition[] = [
  {
    key: 'document',
    label: 'Documento',
    required: true,
    editable: false,
    aliases: [
      'documento',
      'cedula',
      'identificacion',
      'numero de documento',
      'document',
      'id',
    ],
    examples: ['1001', '1002'],
    help: 'Número de cédula; no se repite.',
  },
  {
    key: 'name',
    label: 'Nombre',
    required: true,
    editable: true,
    aliases: ['nombre', 'nombres', 'nombre completo', 'name', 'estudiante'],
    examples: ['Ana Maria Gomez', 'Luis Mora'],
  },
  {
    key: 'program',
    label: 'Carrera',
    required: false,
    editable: true,
    aliases: ['carrera', 'programa', 'program', 'programa academico'],
    examples: ['Ingenieria', 'Medicina'],
  },
  {
    key: 'email',
    label: 'Correo',
    required: false,
    editable: true,
    aliases: ['correo', 'correo electronico', 'email', 'e-mail', 'mail'],
    examples: ['ana@example.com', 'luis@example.com'],
  },
  {
    key: 'phone',
    label: 'Teléfono',
    required: false,
    editable: true,
    aliases: ['telefono', 'celular', 'movil', 'phone', 'tel'],
    examples: ['3001234567', ''],
  },
  {
    key: 'displayName',
    label: 'Nombre en pantalla',
    required: false,
    editable: true,
    aliases: [
      'nombre en pantalla',
      'nombre corto',
      'display name',
      'displayname',
    ],
    examples: ['', ''],
    help: 'Hasta 16 caracteres ASCII; se genera del nombre si se deja vacío.',
  },
];

/** `Teléfono` -> `telefono`, `Display_Name` -> `display name`: how headers are compared. */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

/** Best guess of which CSV column is each field; a column is suggested once. */
export function suggestMapping(
  headers: readonly string[],
): Record<StudentFieldKey, number | null> {
  const mapping = Object.fromEntries(
    STUDENT_FIELDS.map((f) => [f.key, null]),
  ) as Record<StudentFieldKey, number | null>;
  const normalized = headers.map(normalizeHeader);
  const taken = new Set<number>();
  for (const field of STUDENT_FIELDS) {
    const wanted = [normalizeHeader(field.label), ...field.aliases];
    const index = normalized.findIndex(
      (header, i) => wanted.includes(header) && !taken.has(i),
    );
    if (index >= 0) {
      mapping[field.key] = index;
      taken.add(index);
    }
  }
  return mapping;
}

export interface RowIssue {
  field: StudentFieldKey;
  message: string;
}

export type StudentRowValues = Partial<Record<StudentFieldKey, string | null>>;

export type RowCheck =
  | { ok: true; values: Record<StudentFieldKey, string | null> }
  | { ok: false; issues: RowIssue[] };

/**
 * Validates one row of raw cells with the field schemas. A blank optional
 * cell becomes `null`; a blank required one is an error.
 */
export function checkStudentRow(raw: StudentRowValues): RowCheck {
  const values = {} as Record<StudentFieldKey, string | null>;
  const issues: RowIssue[] = [];
  for (const field of STUDENT_FIELDS) {
    const cell = raw[field.key]?.trim() ?? '';
    if (cell === '' && !field.required) {
      values[field.key] = null;
      continue;
    }
    const parsed = studentFieldSchemas[field.key].safeParse(cell);
    if (parsed.success) values[field.key] = parsed.data;
    else {
      issues.push({
        field: field.key,
        message: parsed.error.issues[0]?.message ?? 'Valor no válido',
      });
    }
  }
  return issues.length === 0 ? { ok: true, values } : { ok: false, issues };
}
