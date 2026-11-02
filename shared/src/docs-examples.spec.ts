import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ACK_ERRORS,
  REJECT_REASONS,
  deviceMessageSchema,
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
  it('covers all 18 message types', () => {
    expect(allTypes).toHaveLength(18);
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
