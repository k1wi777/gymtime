export interface Student {
  id: string;
  document: string;
  name: string;
  /** The student's degree (column `programa`, "carrera"). */
  program: string | null;
  /** Optional contact data; never logged and never sent to the reader. */
  email: string | null;
  phone: string | null;
  /** Short name drawn on the reader screen (accents kept); always present in the domain. */
  displayName: string;
  active: boolean;
  /** Derived: true while a consent is recorded (`consentVersion` is set). */
  consented: boolean;
  /** Version of the consent text accepted; null without consent. */
  consentVersion: string | null;
  consentAt: Date | null;
  /** When the personal data was erased (Ley 1581); null for everyone else. */
  anonymizedAt?: Date | null;
}

/** A consent as recorded: `by` is the panel user, or null for the system key. */
export interface ConsentRecord {
  version: string;
  at: Date;
  by: string | null;
}

export interface NewStudent {
  document: string;
  name: string;
  program: string | null;
  email: string | null;
  phone: string | null;
  displayName: string;
  consent?: ConsentRecord | null;
  importBatchId?: string | null;
}

/** The document is not editable; consent has its own operation. */
export interface StudentPatch {
  name?: string;
  program?: string | null;
  email?: string | null;
  phone?: string | null;
  displayName?: string;
}

export interface StudentFilter {
  active?: boolean;
  /** Case-insensitive match on name or document. */
  search?: string;
  program?: string;
}

export class DuplicateDocumentError extends Error {
  constructor() {
    super('A student with this document already exists');
  }
}
