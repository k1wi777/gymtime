import { run, type Runtime } from './cli.js';
import type { FetchLike } from './http.js';

export interface Call {
  method: string;
  path: string;
  body: unknown;
  apiKey: string | undefined;
}

export type Handler = (call: Call) => { status?: number; body?: unknown };

/** Fake `fetch` driven by `handler`; records every call. */
export function fakeServer(handler: Handler) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const call: Call = {
      method: init.method,
      path: input.replace('http://srv', ''),
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      apiKey: init.headers['x-api-key'],
    };
    calls.push(call);
    const { status = 200, body = {} } = handler(call);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      text: async () => JSON.stringify(body),
    };
  };
  return { fetch, calls };
}

export async function invoke(
  argv: string[],
  options: Partial<Runtime> & { fetch?: FetchLike } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    env: { GYM_URL: 'http://srv', GYM_API_KEY: 'test-key' },
    readFile: () => undefined,
    sleep: async () => undefined,
    pollMs: 0,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    ...options,
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
