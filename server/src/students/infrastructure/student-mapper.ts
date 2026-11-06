import { DISPLAY_DEFAULTS, generateDisplayName } from '@gymtime/shared';
import type { Student } from '../domain/student.js';

interface StudentRow {
  id: string;
  document: string;
  name: string;
  program: string | null;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  active: boolean;
  consentVersion: string | null;
  consentAt: Date | null;
}

/**
 * Students created before `display_name` existed have NULL there: the domain
 * always sees a usable value, generated from the name.
 */
export function toStudent(row: StudentRow): Student {
  return {
    id: row.id,
    document: row.document,
    name: row.name,
    program: row.program,
    email: row.email,
    phone: row.phone,
    displayName:
      row.displayName ?? generateDisplayName(row.name, DISPLAY_DEFAULTS.cols),
    active: row.active,
    consented: row.consentVersion !== null,
    consentVersion: row.consentVersion,
    consentAt: row.consentAt,
  };
}
