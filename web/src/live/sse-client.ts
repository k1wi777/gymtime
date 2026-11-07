import type { SystemEvent, SystemEventType } from '@/api/types';

export type ConnectionState =
  'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** The part of `EventSource` this client relies on (a fake in the tests). */
export interface EventSourceLike {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export type ProbeResult = 'ok' | 'unauthorized' | 'error';

export interface SseClientOptions {
  url: string;
  /** Opens a stream with the session cookie (`withCredentials`). */
  open?: (url: string) => EventSourceLike;
  /** Asks the API if the session still lives (`GET /auth/me`). */
  probe: () => Promise<ProbeResult>;
  /** No frame for this long means the connection is dead (heartbeat is 15 s). */
  watchdogMs?: number;
  minRetryMs?: number;
  maxRetryMs?: number;
  /** Failed attempts in a row after which the state reads «desconectado». */
  disconnectedAfter?: number;
  random?: () => number;
}

const CLOSED = 2;
export const WATCHDOG_MS = 45_000;

const EVENT_TYPES: readonly SystemEventType[] = [
  'device.connected',
  'device.disconnected',
  'device.offline_alert',
  'device.clock_skew',
  'offline.review',
  'scan',
  'command',
  'alarm',
  'attendance',
  'enrollment',
  'keepalive',
];

type Listener<T> = (value: T) => void;

/**
 * Own manager over `EventSource`. The browser reconnects by itself after a
 * network cut, but gives up (readyState CLOSED) when the server answers 401 or
 * 5xx, so on that case this client asks the API why, and retries with
 * exponential backoff. A watchdog restarts a stream that went silent, and
 * every (re)connection tells the screens to reload their snapshot, because the
 * server keeps no history of events.
 */
export class SseClient {
  private source: EventSourceLike | null = null;
  private current: ConnectionState = 'connecting';
  private failures = 0;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private readonly events = new Set<Listener<SystemEvent>>();
  private readonly states = new Set<Listener<ConnectionState>>();
  private readonly resyncs = new Set<Listener<void>>();
  private readonly unauthorized = new Set<Listener<void>>();

  constructor(private readonly options: SseClientOptions) {}

  get state(): ConnectionState {
    return this.current;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.failures = 0;
    this.setState('connecting');
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.closeSource();
    this.setState('disconnected');
  }

  onEvent(listener: Listener<SystemEvent>): () => void {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }

  onState(listener: Listener<ConnectionState>): () => void {
    this.states.add(listener);
    return () => this.states.delete(listener);
  }

  /** The session is over: the panel must go to the login. */
  onUnauthorized(listener: Listener<void>): () => void {
    this.unauthorized.add(listener);
    return () => this.unauthorized.delete(listener);
  }

  onResync(listener: Listener<void>): () => void {
    this.resyncs.add(listener);
    return () => this.resyncs.delete(listener);
  }

  private connect(): void {
    this.closeSource();
    if (!this.options.open && typeof EventSource === 'undefined') {
      // No live link possible (very old browser): say so instead of throwing.
      this.setState('disconnected');
      return;
    }
    const open =
      this.options.open ??
      ((url: string): EventSourceLike =>
        new EventSource(url, { withCredentials: true }));
    const source = open(this.options.url);
    this.source = source;
    this.armWatchdog();

    source.onopen = () => {
      if (this.source !== source) return;
      this.failures = 0;
      this.armWatchdog();
      this.setState('connected');
      // Events missed while the stream was down are gone for good.
      for (const listener of this.resyncs) listener();
    };
    source.onerror = () => {
      if (this.source !== source || this.stopped) return;
      if (source.readyState === CLOSED) {
        // The browser gave up: find out whether the session is the reason.
        this.closeSource();
        void this.recover();
      } else {
        // The browser is retrying on its own.
        this.markFailure();
      }
    };
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        if (this.source !== source) return;
        this.armWatchdog();
        if (this.current !== 'connected') {
          this.failures = 0;
          this.setState('connected');
        }
        if (type === 'keepalive') return;
        const event = parse(message.data);
        if (event) for (const listener of this.events) listener(event);
      });
    }
  }

  private async recover(): Promise<void> {
    this.markFailure();
    const verdict = await this.options
      .probe()
      .catch((): ProbeResult => 'error');
    if (this.stopped) return;
    if (verdict === 'unauthorized') {
      this.stop();
      for (const listener of this.unauthorized) listener();
      return;
    }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    const { minRetryMs = 1_000, maxRetryMs = 30_000 } = this.options;
    const random = this.options.random ?? Math.random;
    const base = Math.min(maxRetryMs, minRetryMs * 2 ** (this.failures - 1));
    // Jitter keeps many panels from retrying in step after a server restart.
    const delay = Math.round(base * (0.5 + random() * 0.5));
    clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      if (!this.stopped) this.connect();
    }, delay);
  }

  private armWatchdog(): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.stopped) return;
      this.closeSource();
      this.markFailure();
      this.scheduleRetry();
    }, this.options.watchdogMs ?? WATCHDOG_MS);
  }

  private markFailure(): void {
    this.failures += 1;
    const limit = this.options.disconnectedAfter ?? 3;
    this.setState(this.failures >= limit ? 'disconnected' : 'reconnecting');
  }

  private closeSource(): void {
    const source = this.source;
    this.source = null;
    if (source) {
      source.onopen = null;
      source.onerror = null;
      source.close();
    }
  }

  private clearTimers(): void {
    clearTimeout(this.watchdog);
    clearTimeout(this.retry);
  }

  private setState(next: ConnectionState): void {
    if (this.current === next) return;
    this.current = next;
    for (const listener of this.states) listener(next);
  }
}

function parse(raw: unknown): SystemEvent | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw) as SystemEvent;
    return value && typeof value.type === 'string' ? value : null;
  } catch {
    return null;
  }
}
