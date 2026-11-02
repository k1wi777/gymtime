export const ACK_TIMEOUT_MS = 5000;
export const MAX_RESENDS = 3;

interface Pending {
  raw: string;
  resends: number;
  timer: NodeJS.Timeout;
}

export interface SenderHooks {
  /** Writes a frame to the socket. */
  transmit(raw: string, isResend: boolean): void;
  /** Called when a message exhausted its resends. */
  onGiveUp(id: string, raw: string): void;
}

/**
 * Sends frames that need an `ack` and resends them unchanged (same `id`)
 * every `ackTimeoutMs` up to `maxResends` times.
 */
export class Sender {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly hooks: SenderHooks,
    private readonly ackTimeoutMs = ACK_TIMEOUT_MS,
    private readonly maxResends = MAX_RESENDS,
  ) {}

  send(id: string, raw: string): void {
    this.hooks.transmit(raw, false);
    this.track(id, { raw, resends: 0 });
  }

  /** Resolves a pending message; returns false when `ref` is not pending. */
  confirm(ref: string | null): boolean {
    if (ref === null) return false;
    const entry = this.pending.get(ref);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(ref);
    return true;
  }

  clear(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }

  private track(id: string, state: { raw: string; resends: number }): void {
    const timer = setTimeout(() => this.expire(id), this.ackTimeoutMs);
    this.pending.set(id, { ...state, timer });
  }

  private expire(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (entry.resends >= this.maxResends) {
      this.pending.delete(id);
      this.hooks.onGiveUp(id, entry.raw);
      return;
    }
    this.hooks.transmit(entry.raw, true);
    this.track(id, { raw: entry.raw, resends: entry.resends + 1 });
  }
}
