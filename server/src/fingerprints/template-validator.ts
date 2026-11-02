import { base64Schema } from '@gymtime/shared';
import type { FingerprintsConfig } from './fingerprints.config.js';

export type TemplateIssueCode = 'EMPTY' | 'INVALID_BASE64' | 'BAD_SIZE';

export type TemplateValidation =
  | { ok: true; bytes: Buffer }
  | { ok: false; code: TemplateIssueCode; reason: string };

type SizeRules = Pick<
  FingerprintsConfig,
  'expectedTemplateBytes' | 'templateToleranceBytes'
>;

/** Pure check of a template received from the device. Never echoes its content. */
export function validateTemplate(
  template: string,
  rules: SizeRules,
): TemplateValidation {
  if (template.length === 0) {
    return { ok: false, code: 'EMPTY', reason: 'Template is empty' };
  }
  if (!base64Schema.safeParse(template).success) {
    return {
      ok: false,
      code: 'INVALID_BASE64',
      reason: 'Template is not valid base64',
    };
  }
  const bytes = Buffer.from(template, 'base64');
  const { expectedTemplateBytes: expected, templateToleranceBytes: tolerance } =
    rules;
  if (Math.abs(bytes.length - expected) > tolerance) {
    return {
      ok: false,
      code: 'BAD_SIZE',
      reason: `Template has ${bytes.length} bytes, expected ${expected} (±${tolerance})`,
    };
  }
  return { ok: true, bytes };
}
