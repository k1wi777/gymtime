/** Reconnect waits: 1 s, 2 s, 4 s, ... capped at `maxMs`. */
export class Backoff {
  private attempt = 0;

  constructor(
    private readonly baseMs = 1000,
    private readonly maxMs = 30_000,
  ) {}

  next(): number {
    const delay = Math.min(this.baseMs * 2 ** this.attempt, this.maxMs);
    this.attempt += 1;
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }
}

/** Bounded set of processed message ids; the oldest id is evicted first. */
export class Dedupe {
  private readonly ids = new Set<string>();

  constructor(private readonly capacity = 1000) {}

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    this.ids.delete(id);
    this.ids.add(id);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
  }
}
