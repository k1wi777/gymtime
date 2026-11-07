import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ACK_ERRORS,
  OFFLINE_REVIEW_REASONS,
  REJECT_REASONS,
  deviceMessageSchema,
  offlineEventSchema,
  parseDeviceMessage,
  parseServerMessage,
  serverMessageSchema,
} from './index.js';

const docUrl = new URL('../../docs/protocolo_v0.md', import.meta.url);
const doc = readFileSync(fileURLToPath(docUrl), 'utf8');

const EXAMPLE = /<!-- example: ([\w.]+) -->\s*```json\n([\s\S]*?)\n```/g;
const examples = [...doc.matchAll(EXAMPLE)].map((m) => ({
  type: m[1],
  json: m[2],
}));

const deviceTypes = deviceMessageSchema.options.map((o) => o.shape.type.value);
const serverTypes = serverMessageSchema.options.map((o) => o.shape.type.value);
const allTypes = [...new Set([...deviceTypes, ...serverTypes])];

describe('docs/protocolo_v0.md examples', () => {
  it('covers all 20 message types', () => {
    expect(allTypes).toHaveLength(20);
    const documented = new Set(examples.map((e) => e.type));
    expect([...documented].sort()).toEqual([...allTypes].sort());
  });

  it.each(examples)('example $type passes its schema', ({ type, json }) => {
    const parse = serverTypes.includes(type as never)
      ? parseServerMessage
      : parseDeviceMessage;
    const result = parse(json);
    expect(result).toMatchObject({ ok: true });
    expect(JSON.parse(json).type).toBe(type);
  });

  it('ack examples pass both directions', () => {
    for (const { type, json } of examples.filter((e) => e.type === 'ack')) {
      expect(type).toBe('ack');
      expect(parseDeviceMessage(json)).toMatchObject({ ok: true });
      expect(parseServerMessage(json)).toMatchObject({ ok: true });
    }
  });

  it('lists every error code in its table', () => {
    for (const code of [...REJECT_REASONS, ...ACK_ERRORS]) {
      expect(doc).toContain(`| \`${code}\` |`);
    }
  });
});

interface Vector {
  name: string;
  direction: 'device' | 'server' | 'event';
  expect: 'valid' | 'invalid';
  message?: unknown;
  event?: unknown;
}

const fixturesDir = fileURLToPath(
  new URL('../../docs/fixtures/offline/', import.meta.url),
);
const vectors: Vector[] = readdirSync(fixturesDir)
  .filter((file) => file.endsWith('.jsonl'))
  .flatMap((file) =>
    readFileSync(fixturesDir + file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Vector),
  );

describe('docs/fixtures/offline vectors', () => {
  it('has valid and invalid vectors', () => {
    expect(vectors.some((v) => v.expect === 'valid')).toBe(true);
    expect(vectors.some((v) => v.expect === 'invalid')).toBe(true);
  });

  it.each(vectors)('$expect: $name', (vector) => {
    const ok =
      vector.direction === 'event'
        ? offlineEventSchema.safeParse(vector.event).success
        : (vector.direction === 'server'
            ? parseServerMessage(vector.message)
            : parseDeviceMessage(vector.message)
          ).ok;
    expect(ok).toBe(vector.expect === 'valid');
  });

  it('keeps an ack of every batch valid in both directions', () => {
    const ack = vectors.find((v) => v.name === 'ack de un lote');
    expect(parseDeviceMessage(ack?.message)).toMatchObject({ ok: true });
  });
});

describe('v0 compatibility', () => {
  it('a hello without the new fields still parses', () => {
    const hello = vectors.find((v) => v.name === 'hello v0 sin campos nuevos');
    expect(parseDeviceMessage(hello?.message)).toMatchObject({ ok: true });
  });
});

describe('docs/modo_sin_conexion_firmware.md', () => {
  const guide = readFileSync(
    fileURLToPath(
      new URL('../../docs/modo_sin_conexion_firmware.md', import.meta.url),
    ),
    'utf8',
  );
  const messages = [...guide.matchAll(EXAMPLE)].map((m) => ({
    type: m[1] as string,
    json: m[2] as string,
  }));
  const queueLines = [
    ...guide.matchAll(/<!-- queue-event -->\s*```json\n([\s\S]*?)\n```/g),
  ].map((m) => m[1] as string);

  it('has the message examples of the reconnection flow', () => {
    expect(messages.map((m) => m.type).sort()).toEqual(
      ['ack', 'hello', 'offline.events', 'offline.snapshot'].sort(),
    );
  });

  it.each(messages)('example $type passes its schema', ({ type, json }) => {
    const parse = serverTypes.includes(type as never)
      ? parseServerMessage
      : parseDeviceMessage;
    expect(parse(json)).toMatchObject({ ok: true });
  });

  it('every queue line is a valid event on a single line', () => {
    expect(queueLines.length).toBeGreaterThanOrEqual(4);
    for (const line of queueLines) {
      expect(line).not.toContain('\n');
      expect(offlineEventSchema.safeParse(JSON.parse(line)).success).toBe(true);
    }
  });

  it('lists the eleven points to confirm and the review reasons', () => {
    for (let n = 1; n <= 11; n++) expect(guide).toContain(`| C${n} |`);
    for (const reason of OFFLINE_REVIEW_REASONS) {
      expect(guide).toContain(reason);
    }
  });
});
