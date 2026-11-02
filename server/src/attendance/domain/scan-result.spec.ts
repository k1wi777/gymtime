import { scanResultSchema } from '@gymtime/shared';
import { buildScanResult, buildUnknownScanResult } from './scan-result.js';

const at = new Date('2026-11-02T15:30:00Z');
const student = {
  id: 's1',
  document: '1',
  name: 'Ana',
  program: null,
  active: true,
  consented: true,
};

describe('scan.result payloads (R10, R11)', () => {
  it('answers an entry with the student name and a valid payload', () => {
    const message = buildScanResult(
      { kind: 'entry', occurrence: {} as never },
      student,
      `00000000-0000-4000-8000-000000000001`,
      at,
    );
    expect(message).toMatchObject({
      type: 'scan.result',
      ref: `00000000-0000-4000-8000-000000000001`,
      ts: Math.floor(at.getTime() / 1000),
      payload: {
        result: 'entry',
        studentName: 'Ana',
        reason: null,
        display: { line1: 'Entrada registrada', color: 'green' },
      },
    });
    expect(scanResultSchema.safeParse(message).success).toBe(true);
  });

  it('answers an exit with the student name', () => {
    const message = buildScanResult(
      { kind: 'exit', session: {} as never },
      student,
      `00000000-0000-4000-8000-000000000002`,
      at,
    );
    expect(message.payload).toMatchObject({ result: 'exit', studentName: 'Ana' });
    expect(scanResultSchema.safeParse(message).success).toBe(true);
  });

  it('answers a denial with the reason and the known name', () => {
    const message = buildScanResult(
      { kind: 'denied', reason: 'NOT_IN_SCHEDULE' },
      student,
      `00000000-0000-4000-8000-000000000003`,
      at,
    );
    expect(message.payload).toMatchObject({
      result: 'denied',
      studentName: 'Ana',
      reason: 'NOT_IN_SCHEDULE',
    });
    expect(scanResultSchema.safeParse(message).success).toBe(true);
  });

  it('answers an unknown slot without a name', () => {
    const message = buildScanResult(
      { kind: 'denied', reason: 'UNKNOWN_SLOT' },
      null,
      `00000000-0000-4000-8000-000000000004`,
      at,
    );
    expect(message.payload).toMatchObject({
      result: 'denied',
      studentName: null,
      reason: 'UNKNOWN_SLOT',
    });
    expect(scanResultSchema.safeParse(message).success).toBe(true);
  });

  it('answers an unrecognised fingerprint with `unknown`', () => {
    const message = buildUnknownScanResult(`00000000-0000-4000-8000-000000000005`, at);
    expect(message).toMatchObject({
      type: 'scan.result',
      ref: `00000000-0000-4000-8000-000000000005`,
      payload: {
        result: 'unknown',
        studentName: null,
        reason: null,
        display: { line1: 'Huella no reconocida' },
      },
    });
    expect(scanResultSchema.safeParse(message).success).toBe(true);
  });
});
