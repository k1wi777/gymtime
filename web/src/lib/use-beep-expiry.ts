'use client';

import { useEffect } from 'react';

/** Margin that absorbs clock skew between the server and the browser. */
export const BEEP_EXPIRY_MARGIN_MS = 400;

interface BeepStatus {
  on: boolean;
  durationSec: number | null;
  startedAt: string | null;
}

/**
 * Backup for a missed `alarm` event: a beep with a known duration reloads the
 * status once it has run out. Each reload gets at least the margin of wait, so
 * a skewed clock cannot spin.
 */
export function useBeepExpiry(
  state: BeepStatus | undefined,
  reload: () => void,
): void {
  const on = state?.on ?? false;
  const durationSec = state?.durationSec ?? null;
  const startedAt = state?.startedAt ?? null;
  useEffect(() => {
    if (!on || durationSec === null || startedAt === null) return undefined;
    const endsAt = new Date(startedAt).getTime() + durationSec * 1000;
    if (Number.isNaN(endsAt)) return undefined;
    const wait = Math.max(
      BEEP_EXPIRY_MARGIN_MS,
      endsAt - Date.now() + BEEP_EXPIRY_MARGIN_MS,
    );
    const timer = setTimeout(reload, wait);
    return () => clearTimeout(timer);
  }, [on, durationSec, startedAt, reload]);
}
