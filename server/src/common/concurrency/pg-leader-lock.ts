import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import type { Env } from '../../config/env.schema.js';
import type { LeaderLock } from './leader-lock.js';

/** Fixed key of the advisory lock ("GYMT" in ASCII); one per database. */
export const LEADER_LOCK_KEY = '1196051796';

/**
 * Session-level `pg_try_advisory_lock` on a DEDICATED connection: a pooled
 * one would lose the lock when it is handed back. PostgreSQL releases the
 * lock when the session ends, which is the hand-over when the leader dies.
 * Needs a direct connection: PgBouncer in transaction mode breaks it.
 */
@Injectable()
export class PgLeaderLock implements LeaderLock, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgLeaderLock.name);
  private readonly url: string;
  private readonly retryMs: number;
  private client: pg.Client | null = null;
  private leader = false;
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private stopped = false;

  constructor(config: ConfigService<Env, true>) {
    this.url = config.get('DATABASE_URL', { infer: true });
    this.retryMs = config.get('LEADER_RETRY_SECONDS', { infer: true }) * 1000;
  }

  isLeader(): boolean {
    return this.leader;
  }

  async onModuleInit(): Promise<void> {
    await this.attempt();
    this.timer = setInterval(() => void this.attempt(), this.retryMs);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.lose('shutdown');
    await this.closeClient();
  }

  /** One attempt: a leader verifies its session is alive, others try to take over. */
  async attempt(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      if (this.leader && this.client) {
        await this.client.query('SELECT 1');
        return;
      }
      await this.tryAcquire();
    } catch (error) {
      this.lose(error instanceof Error ? error.message : String(error));
      await this.closeClient();
    } finally {
      this.busy = false;
    }
  }

  private async tryAcquire(): Promise<void> {
    const client = new pg.Client({ connectionString: this.url });
    // A broken session means the lock is gone: stop acting as leader at once.
    client.on('error', () => this.lose('connection error', client));
    client.on('end', () => this.lose('connection closed', client));
    await client.connect();
    const { rows } = await client.query<{ got: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS got',
      [LEADER_LOCK_KEY],
    );
    if (rows[0]?.got) {
      this.client = client;
      this.leader = true;
      this.logger.log({ event: 'leader_acquired' });
      return;
    }
    await client.end();
  }

  private lose(reason: string, from?: pg.Client): void {
    if (from && from !== this.client) return;
    if (this.leader) {
      this.leader = false;
      this.logger.warn({ event: 'leader_lost', reason });
    }
  }

  private async closeClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
  }
}
