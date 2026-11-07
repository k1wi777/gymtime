import { OFFLINE_BATCH_MAX, type OfflineEvent } from '@gymtime/shared';
import type { OfflineQueue } from './offline-queue.js';

export interface SyncHooks {
  /** Sends an `offline.events` frame (tracked, resent unchanged on timeout). Returns its id. */
  sendBatch(payload: {
    batch: number;
    last: boolean;
    events: OfflineEvent[];
  }): string;
  log(text: string): void;
  warn(text: string): void;
}

interface InFlight {
  frameId: string;
  ids: string[];
  last: boolean;
}

/**
 * Sends the queue to the server in batches after the reconnection: one
 * batch at a time, removing it from the queue only when its `ack` is ok.
 * The events keep their `id` in every retry; a batch that failed is sent
 * again in full on the next connection.
 */
export class OfflineSync {
  private inFlight: InFlight | null = null;
  private batch = 0;

  constructor(
    private readonly queue: OfflineQueue,
    private readonly hooks: SyncHooks,
    private readonly batchMax = OFFLINE_BATCH_MAX,
  ) {}

  get busy(): boolean {
    return this.inFlight !== null;
  }

  /** Starts (or restarts) the delivery; a no-op with an empty queue. */
  start(): void {
    this.inFlight = null;
    this.batch = 0;
    this.next();
  }

  /** Forgets the batch in flight (the socket closed). */
  reset(): void {
    this.inFlight = null;
  }

  /** Handles the `ack` of a frame; returns true if it was a batch. */
  onAck(ref: string | null, ok: boolean): boolean {
    const flight = this.inFlight;
    if (!flight || ref !== flight.frameId) return false;
    this.inFlight = null;
    if (!ok) {
      this.hooks.warn(
        `server rejected offline batch ${this.batch}; ${this.queue.size} event(s) kept for the next connection`,
      );
      return true;
    }
    this.queue.remove(flight.ids);
    this.hooks.log(
      `offline batch ${this.batch} confirmed, ${this.queue.size} event(s) left`,
    );
    if (!flight.last) this.next();
    return true;
  }

  private next(): void {
    const events = this.queue.peek(this.batchMax);
    if (events.length === 0) return;
    this.batch += 1;
    const last = this.queue.size <= events.length;
    const frameId = this.hooks.sendBatch({
      batch: this.batch,
      last,
      events,
    });
    this.inFlight = { frameId, ids: events.map((e) => e.id), last };
    this.hooks.log(
      `offline batch ${this.batch}: ${events.length} event(s)${last ? ' (last)' : ''}`,
    );
  }
}
