export interface Student {
  id: string;
  document: string;
  name: string;
  /** The student's degree (column `programa`, "carrera"). */
  program: string | null;
  /** Optional contact data; never logged and never sent to the reader. */
  email: string | null;
  phone: string | null;
  /** Short ASCII name drawn on the reader LCD; always present in the domain. */
  displayName: string;
  active: boolean;
  consented: boolean;
}

export interface NewStudent {
  document: string;
  name: string;
  program: string | null;
  email: string | null;
  phone: string | null;
  displayName: string;
  consented: boolean;
}

/** The document is not editable. */
export interface StudentPatch {
  name?: string;
  program?: string | null;
  email?: string | null;
  phone?: string | null;
  displayName?: string;
  consented?: boolean;
}

export class DuplicateDocumentError extends Error {
  constructor() {
    super('A student with this document already exists');
  }
}
