import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../http.js';
import { invoke } from '../testing.js';

const encoder = new TextEncoder();

function streamOf(...parts: string[]): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const part of parts) yield encoder.encode(part);
  })();
}

function ok(
  body: AsyncIterable<Uint8Array> | null,
): Awaited<ReturnType<FetchLike>> {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body,
    text: async () => '',
  };
}

const scan =
  'event: scan\ndata: {"type":"scan","at":"2026-11-02T16:00:00.000Z","data":{"deviceId":"d1","slot":5,"result":"entry","studentName":"Ana","reason":null}}\n\n';

describe('gym watch', () => {
  it('prints readable events in Bogota time and reconnects with backoff', async () => {
    const streams = [streamOf(scan), streamOf(), streamOf()];
    let call = 0;
    const fetch: FetchLike = async () => ok(streams[call++] ?? streamOf());
    const delays: number[] = [];
    const controller = new AbortController();

    const { code, out } = await invoke(['watch'], {
      fetch,
      signal: controller.signal,
      sleep: async (ms) => {
        delays.push(ms);
        if (delays.length === 2) controller.abort();
      },
    });

    expect(code).toBe(0);
    expect(out).toContain('Watching http://srv/events (Ctrl+C to stop).');
    expect(out).toContain('11:00:00  scan  slot 5 entry Ana');
    expect(out).toContain('Connection lost; reconnecting in 1s...');
    expect(out).toContain('Connection lost; reconnecting in 2s...');
    expect(out).toContain('Stopped.');
    expect(delays).toEqual([1000, 2000]);
  });

  it('ignores keepalive frames', async () => {
    const keepalive =
      'event: keepalive\ndata: {"type":"keepalive","at":"2026-11-02T16:00:00.000Z","data":{}}\n\n';
    const controller = new AbortController();
    const fetch: FetchLike = async () => ok(streamOf(keepalive, scan));

    const { out } = await invoke(['watch'], {
      fetch,
      signal: controller.signal,
      sleep: async () => controller.abort(),
    });

    expect(out).not.toContain('keepalive');
    expect(out).toContain('scan');
  });

  it('stops cleanly on Ctrl+C without printing an error', async () => {
    const controller = new AbortController();
    const fetch: FetchLike = async (_input, init) =>
      ok(
        (async function* () {
          yield encoder.encode(scan);
          await new Promise<void>((resolve) =>
            init.signal?.addEventListener('abort', () => resolve(), {
              once: true,
            }),
          );
        })(),
      );
    setTimeout(() => controller.abort(), 5);

    const { code, out, err } = await invoke(['watch'], {
      fetch,
      signal: controller.signal,
    });

    expect(code).toBe(0);
    expect(out).toContain('scan');
    expect(out).toContain('Stopped.');
    expect(err).toBe('');
  });

  it('exits with an error on a rejected API key without retrying', async () => {
    const fetch: FetchLike = async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '{"message":"Unauthorized"}',
    });

    const { code, out, err } = await invoke(['watch'], { fetch });

    expect(code).toBe(1);
    expect(err).toContain('API key was rejected');
    expect(out).not.toContain('reconnecting');
  });

  it('reports an unreachable server and retries', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    };

    const { code, out } = await invoke(['watch'], {
      fetch,
      signal: controller.signal,
      sleep: async () => controller.abort(),
    });

    expect(code).toBe(0);
    expect(calls).toBe(1);
    expect(out).toContain('Connection lost; reconnecting in 1s...');
    expect(out).toContain('Stopped.');
  });
});
