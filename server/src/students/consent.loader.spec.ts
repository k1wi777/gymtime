import { describe, expect, it, vi } from 'vitest';
import {
  ConsentFileError,
  PROVISIONAL_CONSENT,
  loadConsent,
  warnIfProvisional,
} from './consent.loader.js';
import { buildStudentsService } from './testing.js';

const TEXT =
  'Texto oficial del consentimiento de la Universidad de Córdoba. '.repeat(2);
const file = (content: unknown) => () => JSON.stringify(content);

describe('loadConsent (R13)', () => {
  it('uses the provisional text when no file is configured', () => {
    expect(loadConsent(undefined)).toEqual(PROVISIONAL_CONSENT);
    expect(PROVISIONAL_CONSENT.version).toBe('v1-provisional');
  });

  it('loads and trims a valid file', () => {
    const consent = loadConsent(
      'c.json',
      file({ version: 'v2-2026', text: `  ${TEXT}  ` }),
    );
    expect(consent).toEqual({ version: 'v2-2026', text: TEXT.trim() });
  });

  it('refuses an unreadable file, bad JSON and invalid fields with a clear message', () => {
    expect(() =>
      loadConsent('x.json', () => {
        throw new Error('ENOENT');
      }),
    ).toThrow(/CONSENT_FILE \(x\.json\): no se pudo leer/);
    expect(() => loadConsent('x.json', () => '{nope')).toThrow(
      /no es JSON válido/,
    );
    for (const bad of [
      { version: 'v 2', text: TEXT },
      { version: 'v', text: TEXT },
      { version: 'v2', text: 'corto' },
      { version: 'v2', text: 'x'.repeat(4001) },
      { version: 'v2', text: TEXT, extra: true },
      { text: TEXT },
    ]) {
      expect(() => loadConsent('x.json', file(bad))).toThrow(ConsentFileError);
    }
  });

  it('warns only in production with the provisional text', () => {
    const logger = { warn: vi.fn() };
    warnIfProvisional(PROVISIONAL_CONSENT, false, logger as never);
    warnIfProvisional({ version: 'v2', text: TEXT }, true, logger as never);
    expect(logger.warn).not.toHaveBeenCalled();
    warnIfProvisional(PROVISIONAL_CONSENT, true, logger as never);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe('a new consent version (R13)', () => {
  it('students with an older version must accept the new one; the old one is stale', async () => {
    const { service } = buildStudentsService();
    const student = await service.create({
      document: '1',
      name: 'Ana',
      program: null,
      consented: true,
    });
    expect(student.consentVersion).toBe('v1-provisional');

    const { service: renewed } = buildStudentsService(
      undefined,
      undefined,
      undefined,
      {
        version: 'v2-2026',
        text: TEXT,
      },
    );
    const other = await renewed.create({
      document: '2',
      name: 'Bea',
      program: null,
      consented: true,
    });
    expect(other.consentVersion).toBe('v2-2026');
    await expect(
      renewed.recordConsent(other.id, 'v1-provisional'),
    ).rejects.toMatchObject({
      current: 'v2-2026',
    });
  });
});
