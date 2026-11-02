import { CliError } from './errors.js';
import { parseSseStream, type SystemEvent } from './stream.js';

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  /** Present for streamed responses (`text/event-stream`). */
  body?: AsyncIterable<Uint8Array> | null;
  text(): Promise<string>;
}>;

export interface HttpClientOptions {
  url: string;
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface RequestOptions {
  /** Overrides the client timeout for slow operations such as `sync`. */
  timeoutMs?: number;
}

export interface HttpClient {
  request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T>;
  /** Opens an SSE stream; aborts with `options.signal` (Ctrl+C). */
  stream(path: string, options?: StreamOptions): AsyncIterable<SystemEvent>;
}

export interface StreamOptions {
  signal?: AbortSignal;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

/** Thin JSON client: adds `x-api-key` and turns failures into `CliError`. */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const doFetch: FetchLike =
    options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async request<T>(
      method: string,
      path: string,
      body?: unknown,
      requestOptions?: RequestOptions,
    ) {
      const headers: Record<string, string> = {
        'x-api-key': options.apiKey,
        accept: 'application/json',
      };
      if (body !== undefined) headers['content-type'] = 'application/json';

      let response;
      try {
        response = await doFetch(`${options.url}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(requestOptions?.timeoutMs ?? timeoutMs),
        });
      } catch {
        // The low-level cause (ECONNREFUSED, timeout) is not useful to the operator.
        throw new CliError(`Could not connect to ${options.url}`);
      }

      const text = await response.text().catch(() => '');
      if (!response.ok)
        throw httpError(response.status, response.statusText, text);
      if (text === '') return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new CliError(`Invalid response from ${options.url}`);
      }
    },

    stream(path: string, streamOptions: StreamOptions = {}) {
      return {
        async *[Symbol.asyncIterator](): AsyncIterableIterator<SystemEvent> {
          let response;
          try {
            response = await doFetch(`${options.url}${path}`, {
              method: 'GET',
              headers: {
                'x-api-key': options.apiKey,
                accept: 'text/event-stream',
              },
              signal: streamOptions.signal,
            });
          } catch {
            // Ctrl+C aborts the fetch: a clean end, not a connection failure.
            if (streamOptions.signal?.aborted) return;
            throw new CliError(`Could not connect to ${options.url}`);
          }
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw httpError(response.status, response.statusText, text);
          }
          if (!response.body) return;
          yield* parseSseStream(response.body);
        },
      };
    },
  };
}

/** Server error carrying its HTTP status so commands can react to it. */
export class HttpError extends CliError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function httpError(
  status: number,
  statusText: string,
  text: string,
): HttpError {
  const detail = serverMessage(text);
  const base = `Server responded ${status}${statusText ? ` ${statusText}` : ''}`;
  if (status === 401) {
    return new HttpError(status, `${base}: the admin API key was rejected`);
  }
  return new HttpError(status, detail ? `${base}: ${detail}` : base);
}

/** NestJS error bodies carry `message` as a string or a list of strings. */
function serverMessage(text: string): string {
  try {
    const message = (JSON.parse(text) as { message?: unknown } | null)?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(String).join('; ');
  } catch {
    // Not JSON: ignore the body.
  }
  return '';
}
