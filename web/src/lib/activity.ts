export interface ActivityOptions {
  /** Called to renew the session (a cheap authenticated request). */
  touch: () => void | Promise<unknown>;
  /** Minimum time between two renewals. */
  minIntervalMs?: number;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
}

export const ACTIVITY_INTERVAL_MS = 60_000;
const EVENTS = ['pointerdown', 'keydown'] as const;

/**
 * Renews the server session with the user's real activity. The SSE heartbeat
 * does not count, so an abandoned screen still expires. A burst of activity
 * produces one call immediately and at most one more per interval; with no
 * activity there are no calls at all.
 */
export function trackActivity(options: ActivityOptions): () => void {
  const interval = options.minIntervalMs ?? ACTIVITY_INTERVAL_MS;
  const target = options.target ?? window;
  const now = options.now ?? Date.now;
  let last = -Infinity;
  let pending: ReturnType<typeof setTimeout> | undefined;

  const fire = (): void => {
    pending = undefined;
    last = now();
    void Promise.resolve(options.touch()).catch(() => undefined);
  };

  const onActivity = (): void => {
    if (pending !== undefined) return;
    const wait = last + interval - now();
    if (wait <= 0) fire();
    else pending = setTimeout(fire, wait);
  };

  for (const name of EVENTS) {
    target.addEventListener(name, onActivity, { passive: true });
  }
  return () => {
    for (const name of EVENTS) target.removeEventListener(name, onActivity);
    if (pending !== undefined) clearTimeout(pending);
  };
}
