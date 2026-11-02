export interface Student {
  id: string;
  document: string;
  name: string;
  program: string | null;
  active: boolean;
  consented: boolean;
}

export interface NewStudent {
  document: string;
  name: string;
  program: string | null;
  consented: boolean;
}

/** The document is not editable. */
export interface StudentPatch {
  name?: string;
  program?: string | null;
  consented?: boolean;
}

export class DuplicateDocumentError extends Error {
  constructor() {
    super('A student with this document already exists');
  }
}
