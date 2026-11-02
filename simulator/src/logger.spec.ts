import { createConsoleLogger, redact } from './logger.js';

describe('logger', () => {
  it('masks the hello token', () => {
    const raw = JSON.stringify({
      type: 'hello',
      payload: { token: 'secret-x' },
    });
    expect(redact(raw)).not.toContain('secret-x');
  });

  it('masks fingerprint templates', () => {
    const raw = JSON.stringify({
      type: 'enroll.done',
      payload: { enrollmentId: 'e', template: 'QUJDREVGRw==' },
    });
    const masked = redact(raw);
    expect(masked).not.toContain('QUJDREVGRw==');
    expect(masked).toContain('enrollmentId');
  });

  it('writes time, direction and type', () => {
    const lines: string[] = [];
    const logger = createConsoleLogger(
      (l) => lines.push(l),
      () => new Date('2026-01-01T10:20:30.123Z'),
    );
    logger.frame('out', JSON.stringify({ type: 'status', payload: {} }));
    logger.frame(
      'out',
      JSON.stringify({ type: 'hello', payload: { token: 'secret-x' } }),
      'resend',
    );
    logger.state('online');
    expect(lines[0]).toMatch(/^10:20:30\.123 --> status/);
    expect(lines[1]).not.toContain('secret-x');
    expect(lines[1]).toContain('(resend)');
    expect(lines[2]).toBe('10:20:30.123 ::: online');
  });
});

describe('logger templates.sync (R23)', () => {
  it('masks every template of a sync chunk but keeps the slots', () => {
    const raw = JSON.stringify({
      type: 'templates.sync',
      payload: {
        syncId: 's',
        chunk: { index: 1, total: 1 },
        templates: [
          { slot: 1, template: 'QUJDREVGRw==' },
          { slot: 2, template: 'SElKS0xNTg==' },
        ],
      },
    });
    const masked = redact(raw);
    expect(masked).not.toContain('QUJDREVGRw==');
    expect(masked).not.toContain('SElKS0xNTg==');
    expect(masked).toContain('"slot":2');
  });
});
