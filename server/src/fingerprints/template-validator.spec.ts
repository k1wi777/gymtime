import { randomBytes } from 'node:crypto';
import { validateTemplate } from './template-validator.js';

const rules = { minTemplateBytes: 512, maxTemplateBytes: 768 };
const b64 = (n: number) => Buffer.alloc(n, 7).toString('base64');

describe('validateTemplate', () => {
  it.each([512, 640, 768])('accepts a template of %i bytes', (n) => {
    const result = validateTemplate(b64(n), rules);
    expect(result.ok && result.bytes.length).toBe(n);
  });

  it('accepts a random 768-byte template (real AS608 size)', () => {
    const bytes = randomBytes(768);
    const result = validateTemplate(bytes.toString('base64'), rules);
    expect(result.ok && result.bytes.equals(bytes)).toBe(true);
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

  it.each([100, 511, 769, 1024])('rejects %i bytes as BAD_SIZE', (n) => {
    expect(validateTemplate(b64(n), rules)).toMatchObject({
      ok: false,
      code: 'BAD_SIZE',
    });
  });

  it('does not echo the content', () => {
    const result = validateTemplate(b64(1024), rules);
    expect(JSON.stringify(result)).not.toContain(b64(1024));
    expect(result).toMatchObject({
      reason: expect.stringContaining('512-768'),
    });
  });
});
