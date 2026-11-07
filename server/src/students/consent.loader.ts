import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

/**
 * Consent to process the biometric data (Ley 1581): the text and its version
 * live in the server so that what the panel shows is what gets recorded.
 */
export interface ConsentText {
  version: string;
  text: string;
}

export const CONSENT = Symbol('CONSENT');

/** Version label of the stand-in text used while the university sends the official one. */
export const PROVISIONAL_VERSION = 'v1-provisional';

/**
 * PROVISIONAL: replace it with the official text through `CONSENT_FILE`
 * (docs/consentimiento.ejemplo.json) and raise the version (E25-9); students
 * who consented under an older version must accept again.
 */
export const PROVISIONAL_CONSENT: ConsentText = {
  version: PROVISIONAL_VERSION,
  text: 'Autorizo a la Universidad de Córdoba a tratar mi huella dactilar, dato biométrico sensible, con la única finalidad de controlar el acceso y el tiempo de permanencia en el gimnasio (Ley 1581 de 2012). Solo se guarda la plantilla cifrada, nunca la imagen de la huella, y puedo solicitar su eliminación en cualquier momento.',
};

export const consentFileSchema = z.strictObject({
  version: z
    .string()
    .min(3)
    .max(40)
    .regex(/^\S+$/, 'no puede contener espacios'),
  text: z.string().trim().min(50).max(4000),
});

/** The consent file is missing, unreadable or invalid: the server must not start. */
export class ConsentFileError extends Error {
  constructor(file: string, reason: string) {
    super(`CONSENT_FILE (${file}): ${reason}`);
  }
}

/**
 * Reads the consent text from `file` (JSON `{version, text}`), or falls back
 * to the provisional one when no file is configured. Validated at startup so
 * a typo never reaches a student.
 * @throws ConsentFileError
 */
export function loadConsent(
  file: string | undefined,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): ConsentText {
  if (!file) return PROVISIONAL_CONSENT;
  let raw: string;
  try {
    raw = read(file);
  } catch {
    throw new ConsentFileError(file, 'no se pudo leer el archivo');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ConsentFileError(file, 'no es JSON válido');
  }
  const parsed = consentFileSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'archivo'}: ${issue.message}`)
      .join('; ');
    throw new ConsentFileError(file, problems);
  }
  return { version: parsed.data.version, text: parsed.data.text };
}

/** Warns when production still runs on the provisional text (E25-9). */
export function warnIfProvisional(
  consent: ConsentText,
  production: boolean,
  logger = new Logger('Consent'),
): void {
  if (production && consent.version === PROVISIONAL_VERSION) {
    logger.warn({
      event: 'consent_provisional_in_production',
      version: consent.version,
      hint: 'set CONSENT_FILE with the official text of the university before enrolling real students',
    });
  }
}
