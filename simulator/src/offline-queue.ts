import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { OFFLINE_QUEUE_MAX, type OfflineEvent } from '@gymtime/shared';

/** What the device keeps in its flash (LittleFS) besides the fingerprints. */
export interface LocalState {
  /** Last `offline.snapshot` payload received (names included, as on the device). */
  snapshot: object | null;
  open: number[];
  exited: number[];
}

export const EMPTY_STATE: LocalState = {
  snapshot: null,
  open: [],
  exited: [],
};

export type NewEvent =
  | { type: 'entry' | 'exit'; slot: number }
  | { type: 'unknown' }
  | {
      type: 'alarm';
      endTs: number | null;
      endedBy: 'button' | 'all_exited' | 'timeout';
    };

interface Header {
  seq: number;
  state: LocalState;
}

/**
 * Event queue of the simulated device. With a file it survives a restart
 * without network (one JSON per line: a header, then one event per line); the
 * file is rewritten after every change, as a small LittleFS file would be.
 * It never grows past `OFFLINE_QUEUE_MAX`: when full, the new event is
 * refused (never dropping an old one).
 */
export class OfflineQueue {
  private events: OfflineEvent[] = [];
  private seq = 0;
  state: LocalState = { ...EMPTY_STATE };

  constructor(
    private readonly file: string | null = null,
    private readonly max = OFFLINE_QUEUE_MAX,
  ) {
    if (file && existsSync(file)) this.load(file);
  }

  get size(): number {
    return this.events.length;
  }

  get isFull(): boolean {
    return this.events.length >= this.max;
  }

  /** Oldest first, without removing them. */
  peek(count: number): OfflineEvent[] {
    return this.events.slice(0, count);
  }

  /**
   * Appends an event with a new UUID and the next `seq`. Returns null when the
   * queue is full ("Cola llena"): the caller must reject the scan.
   */
  push(event: NewEvent, ts: number, snapshotId: string): OfflineEvent | null {
    if (this.isFull) return null;
    this.seq += 1;
    const full = {
      ...event,
      id: randomUUID(),
      seq: this.seq,
      ts,
      snapshotId,
    } as OfflineEvent;
    this.events.push(full);
    this.save();
    return full;
  }

  /** Removes the events the server confirmed. */
  remove(ids: readonly string[]): void {
    const gone = new Set(ids);
    this.events = this.events.filter((e) => !gone.has(e.id));
    this.save();
  }

  /** Persists the local state (open/exited/snapshot) next to the queue. */
  setState(state: LocalState): void {
    this.state = state;
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    const header: Header = { seq: this.seq, state: this.state };
    const lines = [
      JSON.stringify(header),
      ...this.events.map((e) => JSON.stringify(e)),
    ];
    writeFileSync(this.file, `${lines.join('\n')}\n`);
  }

  private load(file: string): void {
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const [head, ...rest] = lines;
    if (head) {
      const header = JSON.parse(head) as Header;
      this.seq = header.seq;
      this.state = header.state;
    }
    this.events = rest.map((line) => JSON.parse(line) as OfflineEvent);
  }
}
