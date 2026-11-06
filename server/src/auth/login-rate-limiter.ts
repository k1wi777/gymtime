import type { Clock } from '../common/time/clock.js';

const WINDOW_MS = 60_000;
const SWEEP_THRESHOLD = 1_000;

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window resets; only meaningful when not allowed. */
  retryAfterSeconds: number;
  /** True for the first rejection of a window, so it is audited once. */
  firstRejection: boolean;
}

interface Window {
  count: number;
  startedAt: number;
  rejected: boolean;
}

/**
 * Fixed-window limiter per key (client IP), in memory: there is a single
 * server instance and the account lock, which lives in the database, is the
 * strong control. The clock is injected so tests do not wait.
 */
export class LoginRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly clock: Clock,
    private readonly limit: number,
  ) {}

  hit(key: string): RateLimitDecision {
    const now = this.clock.now().getTime();
    if (this.windows.size > SWEEP_THRESHOLD) this.sweep(now);

    let window = this.windows.get(key);
    if (!window || now - window.startedAt >= WINDOW_MS) {
      window = { count: 0, startedAt: now, rejected: false };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count <= this.limit) {
      return { allowed: true, retryAfterSeconds: 0, firstRejection: false };
    }
    const firstRejection = !window.rejected;
    window.rejected = true;
    const remaining = window.startedAt + WINDOW_MS - now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)),
      firstRejection,
    };
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= WINDOW_MS) this.windows.delete(key);
    }
  }
}
