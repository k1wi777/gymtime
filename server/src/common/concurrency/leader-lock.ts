/**
 * Decides which server instance runs the background schedulers (alarm, sync,
 * expirations, cleanup, alerts) while several share one database. The API,
 * the WebSocket gateway and the event stream run on every instance.
 */
export interface LeaderLock {
  /** True while this instance holds the lock. Cheap and synchronous. */
  isLeader(): boolean;
}

export const LEADER_LOCK = Symbol('LEADER_LOCK');

/** The single-instance case, and the default of unit tests. */
export const ALWAYS_LEADER: LeaderLock = { isLeader: () => true };

/** Shared by the in-memory locks of one process: lets a test simulate two instances. */
export class LeaderRegistry {
  holder: object | null = null;
}

/** In-memory lock: only one holder per registry; `retry` models the periodic attempt. */
export class InMemoryLeaderLock implements LeaderLock {
  constructor(
    private readonly registry: LeaderRegistry = new LeaderRegistry(),
  ) {}

  /** Takes the lock when nobody holds it. Returns whether this one is leader. */
  start(): boolean {
    if (this.registry.holder === null) this.registry.holder = this;
    return this.isLeader();
  }

  retry(): boolean {
    return this.start();
  }

  /** Releases the lock (the instance went down). */
  stop(): void {
    if (this.registry.holder === this) this.registry.holder = null;
  }

  isLeader(): boolean {
    return this.registry.holder === this;
  }
}

/** A started in-memory lock that is leader: for e2e harnesses without PostgreSQL. */
export function startedLeaderLock(): InMemoryLeaderLock {
  const lock = new InMemoryLeaderLock();
  lock.start();
  return lock;
}
