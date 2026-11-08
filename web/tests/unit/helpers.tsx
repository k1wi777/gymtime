import { vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { createApi, setApi, type Api } from '@/api/client';

export type Handler = (request: Request) => Response | Promise<Response>;
export type Routes = Record<string, unknown>;

export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const empty = (status = 204) => new Response(null, { status });

export interface FakeApi {
  api: Api;
  /** Every request received, in order. */
  requests: Request[];
  /** Replaces or adds the answer of a `METHOD /path` route. */
  route: (key: string, handler: unknown) => void;
  calls: (key: string) => Request[];
}

/**
 * Installs an API client whose `fetch` answers from a route table
 * (`'GET /panel/now'` → a body or a handler). No network is touched.
 */
export function installFakeApi(initial: Routes = {}): FakeApi {
  const table = new Map<string, unknown>(Object.entries(initial));
  const requests: Request[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    requests.push(request.clone());
    const path = new URL(request.url).pathname;
    const handler = table.get(`${request.method} ${path}`);
    if (handler === undefined) {
      return json(
        { statusCode: 404, message: `no route ${request.method} ${path}` },
        404,
      );
    }
    return typeof handler === 'function'
      ? (handler as Handler)(request)
      : json(handler);
  };
  const api = createApi({ baseUrl: 'http://api.test', fetch });
  setApi(api);
  return {
    api,
    requests,
    route: (key, handler) => table.set(key, handler),
    calls: (key) =>
      requests.filter((r) => `${r.method} ${new URL(r.url).pathname}` === key),
  };
}

/** Minimal `EventSource`: tests open, feed and break it by hand. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static last(): FakeEventSource {
    const found = FakeEventSource.instances.at(-1);
    if (!found) throw new Error('no EventSource was created');
    return found;
  }
  static reset(): void {
    FakeEventSource.instances = [];
  }

  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<
    string,
    Array<(e: MessageEvent) => void>
  >();

  constructor(
    readonly url: string,
    readonly init?: { withCredentials?: boolean },
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent) => void,
  ): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  /** The browser keeps retrying on its own (readyState CONNECTING). */
  hiccup(): void {
    this.readyState = 0;
    this.onerror?.(new Event('error'));
  }

  /** The browser gave up (server answered 401 or 5xx). */
  fail(): void {
    this.readyState = 2;
    this.onerror?.(new Event('error'));
  }

  emit(type: string, data: unknown = {}, at = new Date().toISOString()): void {
    const frame = { data: JSON.stringify({ type, at, data }) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(frame);
  }
}

/** The live link is created by an effect that may run after the first content: wait for it. */
export const liveSource = (): Promise<FakeEventSource> =>
  waitFor(() => FakeEventSource.last());

export const installFakeEventSource = (): void => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
};

export const account = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ana Asistente',
  username: 'ana',
  role: 'asistente' as const,
  active: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  ...overrides,
});

export const person = (overrides: Record<string, unknown> = {}) => ({
  studentId: '22222222-2222-4222-8222-222222222222',
  name: 'Beto Pérez',
  document: '1001',
  displayName: 'BETO P',
  hasFingerprint: true,
  enteredAt: null,
  exitedAt: null,
  source: null,
  sessionStatus: null,
  ...overrides,
});

export const alarmOff = {
  on: false,
  reason: null,
  instanceId: null,
  durationSec: null,
  startedAt: null,
  openSessions: 0,
};

/** Only `Date` is faked: the pickers open on this Bogota day, timers stay real. */
export function pinToday(iso = '2026-11-06T17:00:00Z'): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}
