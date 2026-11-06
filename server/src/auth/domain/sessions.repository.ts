import type { PanelUser } from './panel-user.js';

export interface AuthSession {
  id: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface NewAuthSession {
  userId: string;
  /** SHA-256 of the cookie token; the token itself is never stored. */
  tokenHash: string;
  now: Date;
  expiresAt: Date;
}

export interface SessionWithUser {
  session: AuthSession;
  user: PanelUser;
}

export interface SessionsRepository {
  create(data: NewAuthSession): Promise<AuthSession>;
  findByTokenHash(tokenHash: string): Promise<SessionWithUser | null>;
  findById(id: string): Promise<SessionWithUser | null>;
  touch(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  /** Revokes every live session of the user, optionally keeping one. */
  revokeAllForUser(
    userId: string,
    at: Date,
    exceptSessionId?: string,
  ): Promise<number>;
  /**
   * Deletes the sessions that can no longer authenticate: revoked, past their
   * absolute expiry, or idle since before `idleBefore`.
   */
  deleteDead(now: Date, idleBefore: Date): Promise<number>;
}

export const SESSIONS_REPOSITORY = Symbol('SESSIONS_REPOSITORY');
