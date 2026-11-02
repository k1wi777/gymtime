import { describe, expect, it } from 'vitest';
import { createSseParser, parseSseStream } from './stream.js';

const encoder = new TextEncoder();

async function* chunks(...parts: string[]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield encoder.encode(part);
}

describe('createSseParser', () => {
  it('parses an event name and its JSON data', () => {
    const parser = createSseParser();
    expect(
      parser.push(
        'event: scan\ndata: {"type":"scan","at":"2026-11-02T16:00:00.000Z","data":{"slot":5}}\n\n',
      ),
    ).toEqual([
      {
        type: 'scan',
        at: '2026-11-02T16:00:00.000Z',
        data: { slot: 5 },
      },
    ]);
  });

  it('joins multiline data and ignores comments and unknown fields', () => {
    const parser = createSseParser();
    const events = parser.push(
      ': keepalive comment\nid: 7\nretry: 1000\nevent: alarm\ndata: {"type":"alarm",\ndata: "at":"2026-11-02T16:00:00.000Z",\ndata: "data":{"on":true}}\n\n',
    );
    expect(events).toEqual([
      {
        type: 'alarm',
        at: '2026-11-02T16:00:00.000Z',
        data: { on: true },
      },
    ]);
  });

  it('keeps state across chunks split mid-line', () => {
    const parser = createSseParser();
    expect(parser.push('event: sc')).toEqual([]);
    expect(parser.push('an\ndata: {"type":"scan",')).toEqual([]);
    expect(
      parser.push('"at":"2026-11-02T16:00:00.000Z","data":{}}\n\n'),
    ).toEqual([
      {
        type: 'scan',
        at: '2026-11-02T16:00:00.000Z',
        data: {},
      },
    ]);
  });

  it('defaults the event name to message and survives malformed data', () => {
    const parser = createSseParser();
    const [event] = parser.push('data: not json\n\n');
    expect(event?.type).toBe('message');
    expect(event?.data).toEqual({});
  });

  it('parses keepalive frames like any other event', () => {
    const parser = createSseParser();
    expect(
      parser.push(
        'event: keepalive\ndata: {"type":"keepalive","at":"2026-11-02T16:00:00.000Z","data":{}}\n\n',
      ),
    ).toEqual([
      {
        type: 'keepalive',
        at: '2026-11-02T16:00:00.000Z',
        data: {},
      },
    ]);
  });
});

describe('parseSseStream', () => {
  it('yields events from a byte stream', async () => {
    const events: unknown[] = [];
    for await (const event of parseSseStream(
      chunks(
        'event: scan\ndata: {"type":"scan","at":"2026-11-02T16:00:00.000Z","data":{"slot":5}}\n\n',
        'event: alarm\ndata: {"type":"alarm","at":"2026-11-02T16:00:01.000Z","data":{"on":false}}\n\n',
      ),
    )) {
      events.push(event);
    }
    expect(events).toHaveLength(2);
  });
});
