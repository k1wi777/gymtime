import { randomUUID } from 'node:crypto';
import type {
  AuthSession,
  NewAuthSession,
  SessionWithUser,
  SessionsRepository,
} from '../domain/sessions.repository.js';
import type { UsersRepository } from '../domain/users.repository.js';

interface StoredSession extends AuthSession {
  tokenHash: string;
}

export class InMemorySessionsRepository implements SessionsRepository {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(private readonly users: UsersRepository) {}

  create(data: NewAuthSession): Promise<AuthSession> {
    const stored: StoredSession = {
      id: randomUUID(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      createdAt: data.now,
      lastActivityAt: data.now,
      expiresAt: data.expiresAt,
      revokedAt: null,
    };
    this.sessions.set(stored.id, stored);
    return Promise.resolve(publicSession(stored));
  }

  findByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    const found = [...this.sessions.values()].find(
      (session) => session.tokenHash === tokenHash,
    );
    return this.withUser(found);
  }

  findById(id: string): Promise<SessionWithUser | null> {
    return this.withUser(this.sessions.get(id));
  }

  touch(id: string, at: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session) session.lastActivityAt = at;
    return Promise.resolve();
  }

  revoke(id: string, at: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session && !session.revokedAt) session.revokedAt = at;
    return Promise.resolve();
  }

  revokeAllForUser(
    userId: string,
    at: Date,
    exceptSessionId?: string,
  ): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId !== userId || session.id === exceptSessionId) continue;
      if (session.revokedAt) continue;
      session.revokedAt = at;
      count += 1;
    }
    return Promise.resolve(count);
  }

  deleteDead(now: Date, idleBefore: Date): Promise<number> {
    let count = 0;
    for (const session of this.sessions.values()) {
      const dead =
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        session.lastActivityAt <= idleBefore;
      if (dead && this.sessions.delete(session.id)) count += 1;
    }
    return Promise.resolve(count);
  }

  /** Test helper: number of stored sessions, live or not. */
  size(): number {
    return this.sessions.size;
  }

  /** Test helper: the stored token hashes. */
  tokenHashes(): string[] {
    return [...this.sessions.values()].map((session) => session.tokenHash);
  }

  private async withUser(
    stored: StoredSession | undefined,
  ): Promise<SessionWithUser | null> {
    if (!stored) return null;
    const user = await this.users.findById(stored.userId);
    return user ? { session: publicSession(stored), user } : null;
  }
}

function publicSession(stored: StoredSession): AuthSession {
  const { tokenHash: _tokenHash, ...session } = stored;
  return { ...session };
}
