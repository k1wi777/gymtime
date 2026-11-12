import {
  ACK_ERRORS,
  ACK_ERROR_DESCRIPTIONS,
  REJECT_REASONS,
  REJECT_REASON_DESCRIPTIONS,
  parseDeviceMessage,
  parseServerMessage,
} from './index.js';

const ID = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const REF = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const TEMPLATE = 'AAECAwQFBgcICQoLDA0ODw==';
const DISPLAY = {
  title: 'Ana',
  subtitle: 'Entrada registrada',
  tone: 'success',
  line1: 'Ana',
  line2: 'Entrada registrada',
  color: 'green',
};

function envelope(type: string, payload: object, ref: string | null = null) {
  return { v: 1, id: ID, type, ts: 1760000000, ref, payload };
}

type Case = { type: string; payload: object; ref?: string | null; bad: object };

const deviceCases: Case[] = [
  {
    type: 'hello',
    payload: { deviceId: 'esp32-01', token: 't', fw: '1.0.0' },
    bad: { deviceId: 'esp32-01', token: '', fw: '1.0.0' },
  },
  {
    type: 'fingerprint.scan',
    payload: { slot: 3, confidence: 120 },
    bad: { slot: 0, confidence: 120 },
  },
  { type: 'fingerprint.unknown', payload: {}, bad: { extra: 1 } },
  {
    type: 'enroll.progress',
    payload: { enrollmentId: REF, step: 'place_finger' },
    bad: { enrollmentId: REF, step: 'dance' },
  },
  {
    type: 'enroll.done',
    payload: { enrollmentId: REF, template: TEMPLATE },
    bad: { enrollmentId: REF, template: '' },
  },
  {
    type: 'enroll.failed',
    payload: { enrollmentId: REF, reason: 'timeout' },
    bad: { enrollmentId: 'x', reason: 'timeout' },
  },
  {
    type: 'alarm.state',
    payload: { on: true, source: 'button' },
    bad: { on: true, source: 'moon' },
  },
  { type: 'button.pressed', payload: {}, bad: { pressed: true } },
  {
    type: 'status',
    payload: { uptime: 10, heap: 2000, rssi: -60, fingerprintCount: 4 },
    bad: { uptime: -1, heap: 2000, rssi: -60, fingerprintCount: 4 },
  },
  {
    type: 'ack',
    payload: { ok: false, error: 'INVALID_MESSAGE' },
    ref: REF,
    bad: { ok: false, error: 'NOPE' },
  },
];

const serverCases: Case[] = [
  {
    type: 'hello.ok',
    payload: { serverTime: 1760000000, heartbeatSec: 30 },
    ref: REF,
    bad: { serverTime: 1760000000, heartbeatSec: 0 },
  },
  {
    type: 'scan.result',
    payload: {
      result: 'entry',
      studentName: 'Ana',
      reason: null,
      display: DISPLAY,
    },
    ref: REF,
    bad: { result: 'entry', studentName: 'Ana', reason: null },
  },
  {
    type: 'enroll.start',
    payload: { enrollmentId: REF, scratchSlot: 162, timeoutSec: 60 },
    bad: { enrollmentId: REF, scratchSlot: 163, timeoutSec: 60 },
  },
  {
    type: 'enroll.cancel',
    payload: { enrollmentId: REF },
    bad: {},
  },
  {
    type: 'templates.sync',
    payload: {
      syncId: REF,
      chunk: { index: 1, total: 1 },
      templates: [{ slot: 1, template: TEMPLATE }],
    },
    bad: { syncId: REF, chunk: { index: 1, total: 2 }, templates: [] },
  },
  {
    type: 'schedule.set',
    payload: {
      scheduleId: 's1',
      start: 1760000000,
      end: 1760003600,
      entryOpensAt: 1759999000,
      entryClosesAt: 1760000600,
    },
    bad: { scheduleId: 's1', start: 'now' },
  },
  {
    type: 'alarm.set',
    payload: { on: true, durationSec: null, reason: 'MANUAL' },
    bad: { on: true, durationSec: 5, reason: 'WHENEVER' },
  },
  {
    type: 'display.message',
    payload: { ...DISPLAY, durationSec: 5 },
    bad: { ...DISPLAY, tone: 'purple', durationSec: 5 },
  },
  {
    type: 'ack',
    payload: { ok: true },
    ref: REF,
    bad: { ok: 'yes' },
  },
];

describe.each([
  ['device', deviceCases, parseDeviceMessage],
  ['server', serverCases, parseServerMessage],
] as const)('%s messages', (_name, cases, parse) => {
  it.each(cases)('accepts a valid $type', ({ type, payload, ref }) => {
    const result = parse(envelope(type, payload, ref ?? null));
    expect(result).toMatchObject({ ok: true });
  });

  it.each(cases)('rejects an invalid $type payload', ({ type, bad, ref }) => {
    const result = parse(envelope(type, bad, ref ?? null));
    expect(result).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
  });

  it.each(cases)('parses JSON text for $type', ({ type, payload, ref }) => {
    const text = JSON.stringify(envelope(type, payload, ref ?? null));
    expect(parse(text)).toMatchObject({ ok: true });
  });
});

describe('envelope and ref rules (R2, R7)', () => {
  it('requires a non-null ref on ack, hello.ok and scan.result', () => {
    expect(
      parseDeviceMessage(envelope('ack', { ok: true }, null)),
    ).toMatchObject({ ok: false });
    expect(
      parseServerMessage(
        envelope('hello.ok', { serverTime: 1, heartbeatSec: 30 }, null),
      ),
    ).toMatchObject({ ok: false });
  });

  it('requires a null ref on non-response messages', () => {
    const result = parseDeviceMessage(envelope('button.pressed', {}, REF));
    expect(result).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect((result as { reason: string }).reason).toContain('ref');
  });

  it('rejects non-uuid ids and negative or fractional ts', () => {
    expect(
      parseDeviceMessage({ ...envelope('button.pressed', {}), id: 'abc' }),
    ).toMatchObject({ ok: false });
    expect(
      parseDeviceMessage({ ...envelope('button.pressed', {}), ts: 1.5 }),
    ).toMatchObject({ ok: false });
  });

  it('rejects unknown envelope fields', () => {
    expect(
      parseDeviceMessage({ ...envelope('button.pressed', {}), extra: 1 }),
    ).toMatchObject({ ok: false });
  });
});

describe('rejection with reason (R8)', () => {
  it('flags malformed JSON', () => {
    expect(parseDeviceMessage('{nope')).toEqual({
      ok: false,
      code: 'INVALID_MESSAGE',
      reason: 'malformed JSON',
    });
  });

  it('flags non-object input', () => {
    expect(parseDeviceMessage('[1]')).toMatchObject({
      ok: false,
      code: 'INVALID_MESSAGE',
    });
    expect(parseServerMessage(null)).toMatchObject({ ok: false });
  });

  it('flags unsupported versions', () => {
    expect(
      parseDeviceMessage({ ...envelope('button.pressed', {}), v: 2 }),
    ).toMatchObject({ ok: false, code: 'UNSUPPORTED_VERSION' });
  });

  it('flags unknown types, and types of the other direction', () => {
    expect(parseDeviceMessage(envelope('teleport', {}))).toMatchObject({
      ok: false,
      code: 'UNKNOWN_TYPE',
    });
    expect(parseDeviceMessage(envelope('alarm.set', {}))).toMatchObject({
      ok: false,
      code: 'UNKNOWN_TYPE',
    });
  });

  it('names the affected field', () => {
    const result = parseDeviceMessage(
      envelope('fingerprint.scan', { slot: 'x', confidence: 1 }),
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toContain('payload.slot');
  });

  it('flags a missing field', () => {
    const result = parseDeviceMessage(
      envelope('hello', { deviceId: 'a', token: 'b' }),
    );
    expect((result as { reason: string }).reason).toContain('payload.fw');
  });
});

describe('base64 and alarm.set (R9)', () => {
  const done = (template: string) =>
    parseDeviceMessage(
      envelope('enroll.done', { enrollmentId: REF, template }),
    );

  it('accepts valid base64 and rejects invalid text', () => {
    expect(done(TEMPLATE)).toMatchObject({ ok: true });
    expect(done('abcd')).toMatchObject({ ok: true });
    expect(done('abc')).toMatchObject({ ok: false });
    expect(done('not base64!')).toMatchObject({ ok: false });
    expect(done('')).toMatchObject({ ok: false });
  });

  it('accepts a 512-byte template', () => {
    expect(done(Buffer.alloc(512, 7).toString('base64'))).toMatchObject({
      ok: true,
    });
  });

  const alarm = (durationSec: unknown) =>
    parseServerMessage(
      envelope('alarm.set', { on: true, durationSec, reason: 'TEST' }),
    );

  it('accepts positive integer or null durationSec only', () => {
    expect(alarm(10)).toMatchObject({ ok: true });
    expect(alarm(null)).toMatchObject({ ok: true });
    expect(alarm(0)).toMatchObject({ ok: false });
    expect(alarm(-3)).toMatchObject({ ok: false });
    expect(alarm(1.5)).toMatchObject({ ok: false });
    expect(alarm('5')).toMatchObject({ ok: false });
  });
});

describe('templates.sync limits (R8)', () => {
  const sync = (
    chunk: object,
    templates: { slot: number; template: string }[],
  ) =>
    parseServerMessage(
      envelope('templates.sync', { syncId: REF, chunk, templates }),
    );
  const entries = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ slot: i + 1, template: TEMPLATE }));

  it('accepts up to 10 templates and rejects 11', () => {
    expect(sync({ index: 1, total: 2 }, entries(10))).toMatchObject({
      ok: true,
    });
    expect(sync({ index: 1, total: 2 }, entries(11))).toMatchObject({
      ok: false,
    });
  });

  it('keeps chunk.index within 1..total', () => {
    expect(sync({ index: 2, total: 2 }, entries(1))).toMatchObject({
      ok: true,
    });
    expect(sync({ index: 0, total: 2 }, entries(1))).toMatchObject({
      ok: false,
    });
    const over = sync({ index: 3, total: 2 }, entries(1));
    expect((over as { reason: string }).reason).toContain('chunk.index');
  });

  it('accepts an empty list only as a single 1-of-1 chunk (R15)', () => {
    expect(sync({ index: 1, total: 1 }, [])).toMatchObject({ ok: true });
    expect(sync({ index: 1, total: 2 }, [])).toMatchObject({ ok: false });
    expect(sync({ index: 2, total: 2 }, [])).toMatchObject({ ok: false });
  });

  it('rejects repeated slots, out-of-range slots and bad templates', () => {
    const dup = [
      { slot: 1, template: TEMPLATE },
      { slot: 1, template: TEMPLATE },
    ];
    expect(sync({ index: 1, total: 1 }, dup)).toMatchObject({ ok: false });
    expect(
      sync({ index: 1, total: 1 }, [{ slot: 163, template: TEMPLATE }]),
    ).toMatchObject({ ok: false });
    expect(
      sync({ index: 1, total: 1 }, [{ slot: 1, template: '***' }]),
    ).toMatchObject({ ok: false });
  });
});

describe('display payload (R1, R2, R3)', () => {
  const show = (payload: object) =>
    parseServerMessage(envelope('display.message', payload));

  it('rejects an empty title unless the screen is being cleared', () => {
    const clear = { ...DISPLAY, title: '', subtitle: '', line1: '', line2: '' };
    expect(show({ ...clear, durationSec: 3 })).toMatchObject({ ok: true });
    expect(
      show({ ...clear, subtitle: 'x', line2: 'x', durationSec: 3 }),
    ).toMatchObject({ ok: false });
  });

  it('keeps the deprecated aliases required during the transition', () => {
    const { line1: _l1, ...withoutLine1 } = DISPLAY;
    expect(show({ ...withoutLine1, durationSec: 3 })).toMatchObject({
      ok: false,
    });
  });

  it('rejects unknown fields and tones', () => {
    expect(show({ ...DISPLAY, durationSec: 3, extra: 1 })).toMatchObject({
      ok: false,
    });
    expect(show({ ...DISPLAY, tone: 'blue', durationSec: 3 })).toMatchObject({
      ok: false,
    });
  });
});

describe('scan.result (R11, R12)', () => {
  const scan = (payload: object) =>
    parseServerMessage(envelope('scan.result', payload, REF));

  it('requires a reject code when denied', () => {
    expect(
      scan({
        result: 'denied',
        studentName: 'Ana',
        reason: 'STUDENT_INACTIVE',
        display: DISPLAY,
      }),
    ).toMatchObject({ ok: true });
    expect(
      scan({
        result: 'denied',
        studentName: null,
        reason: 'UNKNOWN_SLOT',
        display: DISPLAY,
      }),
    ).toMatchObject({ ok: true });
    expect(
      scan({
        result: 'denied',
        studentName: 'Ana',
        reason: null,
        display: DISPLAY,
      }),
    ).toMatchObject({ ok: false });
    expect(
      scan({
        result: 'denied',
        studentName: 'Ana',
        reason: 'MADE_UP',
        display: DISPLAY,
      }),
    ).toMatchObject({ ok: false });
  });

  it('requires a null reason on entry and exit', () => {
    for (const result of ['entry', 'exit']) {
      expect(
        scan({
          result,
          studentName: 'Ana',
          reason: 'ALREADY_EXITED',
          display: DISPLAY,
        }),
      ).toMatchObject({ ok: false });
    }
  });

  it('accepts unknown with null name and reason', () => {
    expect(
      scan({
        result: 'unknown',
        studentName: null,
        reason: null,
        display: DISPLAY,
      }),
    ).toMatchObject({ ok: true });
  });

  it('accepts every reject reason', () => {
    for (const reason of REJECT_REASONS) {
      expect(
        scan({ result: 'denied', studentName: null, reason, display: DISPLAY }),
      ).toMatchObject({ ok: true });
    }
  });
});

describe('error code lists (R10, R11)', () => {
  it('has the six reject reasons from the protocol', () => {
    expect([...REJECT_REASONS]).toEqual([
      'UNKNOWN_SLOT',
      'NO_ACTIVE_SCHEDULE',
      'NOT_IN_SCHEDULE',
      'OUTSIDE_ENTRY_WINDOW',
      'ALREADY_EXITED',
      'STUDENT_INACTIVE',
    ]);
  });

  it('describes every code in Spanish text', () => {
    for (const code of REJECT_REASONS)
      expect(REJECT_REASON_DESCRIPTIONS[code].length).toBeGreaterThan(0);
    for (const code of ACK_ERRORS)
      expect(ACK_ERROR_DESCRIPTIONS[code].length).toBeGreaterThan(0);
  });

  it('accepts every ack error and rejects reject reasons in ack', () => {
    for (const error of ACK_ERRORS) {
      expect(
        parseServerMessage(envelope('ack', { ok: false, error }, REF)),
      ).toMatchObject({ ok: true });
    }
    expect(
      parseServerMessage(
        envelope('ack', { ok: false, error: 'UNKNOWN_SLOT' }, REF),
      ),
    ).toMatchObject({ ok: false });
  });
});
