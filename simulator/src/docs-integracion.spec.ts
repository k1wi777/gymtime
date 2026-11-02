import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  deviceMessageSchema,
  parseDeviceMessage,
  parseServerMessage,
  serverMessageSchema,
} from '@gymtime/shared';

const docUrl = new URL('../../docs/integracion_firmware.md', import.meta.url);
const doc = readFileSync(fileURLToPath(docUrl), 'utf8');

const EXAMPLE = /<!-- example: ([\w.]+) -->\s*```json\n([\s\S]*?)\n```/g;
const examples = [...doc.matchAll(EXAMPLE)].map((m) => ({
  type: m[1],
  json: m[2],
}));

const serverTypes = serverMessageSchema.options.map((o) => o.shape.type.value);
const deviceTypes = deviceMessageSchema.options.map((o) => o.shape.type.value);

describe('docs/integracion_firmware.md examples', () => {
  it('documents the messages of the connection sequence', () => {
    const documented = new Set(examples.map((e) => e.type));
    for (const type of ['hello', 'hello.ok', 'status', 'ack']) {
      expect(documented).toContain(type);
    }
  });

  it.each(examples)('example $type passes its schema', ({ type, json }) => {
    expect([...serverTypes, ...deviceTypes]).toContain(type);
    const parse = serverTypes.includes(type as never)
      ? parseServerMessage
      : parseDeviceMessage;
    expect(parse(json)).toMatchObject({ ok: true });
    expect(JSON.parse(json).type).toBe(type);
  });

  it('keeps the json blocks without a marker out of the guide', () => {
    const blocks = doc.match(/```json/g) ?? [];
    expect(blocks).toHaveLength(examples.length);
  });

  it('links the protocol instead of duplicating it', () => {
    expect(doc).toContain('(./protocolo_v0.md)');
  });
});
