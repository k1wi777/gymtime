import { validateTemplate } from './template-validator.js';

const rules = { expectedTemplateBytes: 512, templateToleranceBytes: 0 };
const b64 = (n: number) => Buffer.alloc(n, 7).toString('base64');

describe('validateTemplate', () => {
  it('accepts a template of the expected size', () => {
    const result = validateTemplate(b64(512), rules);
    expect(result.ok && result.bytes.length).toBe(512);
  });

  it('rejects an empty template', () => {
    expect(validateTemplate('', rules)).toMatchObject({ code: 'EMPTY' });
  });

  it.each(['not base64!', 'abc', 'AAAA=AAA'])('rejects %j as base64', (v) => {
    expect(validateTemplate(v, rules)).toMatchObject({
      ok: false,
      code: 'INVALID_BASE64',
    });
  });

  it('rejects a wrong size and does not echo the content', () => {
    const result = validateTemplate(b64(100), rules);
    expect(result).toMatchObject({ ok: false, code: 'BAD_SIZE' });
    expect(JSON.stringify(result)).not.toContain(b64(100));
  });

  it('honours the configured tolerance', () => {
    const wide = { ...rules, templateToleranceBytes: 8 };
    expect(validateTemplate(b64(506), wide).ok).toBe(true);
    expect(validateTemplate(b64(520), wide).ok).toBe(true);
    expect(validateTemplate(b64(521), wide).ok).toBe(false);
    expect(validateTemplate(b64(511), rules).ok).toBe(false);
  });
});
