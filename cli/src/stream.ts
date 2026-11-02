/** One event of the administration stream; not part of the device protocol. */
export interface SystemEvent {
  type: string;
  /** ISO-8601 instant of the event. */
  at: string;
  data: Record<string, unknown>;
}

export interface SseParser {
  /** Feeds a chunk and returns the events completed by it. */
  push(chunk: string): SystemEvent[];
}

/**
 * Incremental Server-Sent Events parser: line-buffered, joins multiline
 * `data:`, ignores comments and unknown fields and defaults the event name to
 * `message`.
 */
export function createSseParser(): SseParser {
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const dispatch = (out: SystemEvent[]): void => {
    if (dataLines.length > 0) {
      const event = toEvent(eventName, dataLines.join('\n'));
      if (event) out.push(event);
    }
    eventName = 'message';
    dataLines = [];
  };

  return {
    push(chunk: string): SystemEvent[] {
      buffer += chunk;
      const out: SystemEvent[] = [];
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          dispatch(out);
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          let value = colon === -1 ? '' : line.slice(colon + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'event') eventName = value === '' ? 'message' : value;
          else if (field === 'data') dataLines.push(value);
        }
        newline = buffer.indexOf('\n');
      }
      return out;
    },
  };
}

/** Reads an SSE byte stream and yields its events. */
export async function* parseSseStream(
  body: AsyncIterable<Uint8Array>,
): AsyncIterable<SystemEvent> {
  const decoder = new TextDecoder();
  const parser = createSseParser();
  for await (const chunk of body) {
    for (const event of parser.push(decoder.decode(chunk, { stream: true }))) {
      yield event;
    }
  }
}

function toEvent(name: string, payload: string): SystemEvent | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (isRecord(parsed) && typeof parsed['type'] === 'string') {
      return {
        type: parsed['type'],
        at:
          typeof parsed['at'] === 'string'
            ? parsed['at']
            : new Date().toISOString(),
        data: isRecord(parsed['data']) ? parsed['data'] : {},
      };
    }
  } catch {
    // Malformed data: ignored instead of breaking the stream.
  }
  return { type: name, at: new Date().toISOString(), data: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
