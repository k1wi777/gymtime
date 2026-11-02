/**
 * Runs tasks with the same key one at a time (in memory: one server process).
 * A failing task does not block the ones queued behind it.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
