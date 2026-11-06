import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { runAsActor } from '../common/audit/actor.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { type Account, toAccount } from './account.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import {
  InvalidCredentialsError,
  InvalidCurrentPasswordError,
  LoginRateLimitedError,
  PasswordPolicyError,
} from './auth.errors.js';
import type { PanelUser } from './domain/panel-user.js';
import {
  SESSIONS_REPOSITORY,
  type SessionWithUser,
  type SessionsRepository,
} from './domain/sessions.repository.js';
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from './domain/users.repository.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { PasswordHasher } from './password-hasher.js';
import { checkPassword } from './password-policy.js';
import { normalizeUsername } from './username.js';

/** `last_activity_at` is written at most once per this interval per session. */
export const ACTIVITY_THROTTLE_MS = 60_000;

const DUMMY_PASSWORD = 'timing-equalizer-for-unknown-users';

export interface LoginInput {
  username: string;
  password: string;
  ip: string;
}

export interface LoginResult {
  /** Cookie value; shown to the client once and stored only as a hash. */
  token: string;
  account: Account;
  maxAgeMs: number;
}

/** A request that carries a live session. */
export interface SessionContext {
  sessionId: string;
  account: Account;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Sign-in, sessions and password changes of the panel accounts. Nothing it
 * writes to the audit trail or to the logs contains a password, a hash or a
 * cookie value.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly limiter: LoginRateLimiter;
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(SESSIONS_REPOSITORY) private readonly sessions: SessionsRepository,
    private readonly hasher: PasswordHasher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly events: EventLogService,
  ) {
    this.limiter = new LoginRateLimiter(clock, config.loginRateLimit);
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const decision = this.limiter.hit(input.ip);
    if (!decision.allowed) {
      if (decision.firstRejection) {
        this.logger.warn({ event: 'login_rate_limited' });
        await this.events.record('auth.login_rate_limited', { ip: input.ip });
      }
      throw new LoginRateLimitedError(decision.retryAfterSeconds);
    }

    const now = this.clock.now();
    const user = await this.users.findByUsername(
      normalizeUsername(input.username),
    );
    // Always verify, against a throw-away hash when the user is unknown, so
    // the response time does not reveal whether the account exists.
    const passwordOk = await this.hasher.verify(
      input.password,
      user?.passwordHash ?? (await this.getDummyHash()),
    );

    const rejection = this.rejectionReason(user, now);
    if (!user || rejection) {
      await this.events.record('auth.login_failed', {
        reason: rejection ?? 'unknown_user',
        ...(user ? { userId: user.id } : {}),
      });
      throw new InvalidCredentialsError();
    }
    if (!passwordOk) {
      await this.registerFailure(user, now);
      throw new InvalidCredentialsError();
    }

    await this.users.update(user.id, {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: now,
    });
    const token = randomBytes(32).toString('base64url');
    await this.sessions.create({
      userId: user.id,
      tokenHash: hashToken(token),
      now,
      expiresAt: new Date(now.getTime() + this.config.sessionMaxMs),
    });
    await runAsActor({ type: 'user', id: user.id }, () =>
      this.events.record('auth.login_ok', {}),
    );
    return {
      token,
      account: toAccount({ ...user, lastLoginAt: now }),
      maxAgeMs: this.config.sessionMaxMs,
    };
  }

  /** The live session behind a cookie value, or null. Renews the idle timer. */
  async authenticate(token: string): Promise<SessionContext | null> {
    const found = await this.sessions.findByTokenHash(hashToken(token));
    const now = this.clock.now();
    if (!found || !this.isLive(found, now)) return null;
    if (
      now.getTime() - found.session.lastActivityAt.getTime() >=
      ACTIVITY_THROTTLE_MS
    ) {
      await this.sessions.touch(found.session.id, now);
    }
    return { sessionId: found.session.id, account: toAccount(found.user) };
  }

  /** Whether a session still authenticates; does not renew the idle timer. */
  async isSessionActive(sessionId: string): Promise<boolean> {
    const found = await this.sessions.findById(sessionId);
    return found !== null && this.isLive(found, this.clock.now());
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, this.clock.now());
    await this.events.record('auth.logout', {});
  }

  /** Revokes every session of an account (deactivation, password reset). */
  revokeUserSessions(
    userId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    return this.sessions.revokeAllForUser(
      userId,
      this.clock.now(),
      exceptSessionId,
    );
  }

  async changePassword(
    session: SessionContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<Account> {
    const user = await this.users.findById(session.account.id);
    if (!user) throw new InvalidCurrentPasswordError();
    if (!(await this.hasher.verify(currentPassword, user.passwordHash))) {
      await this.events.record('auth.password_change_failed', {});
      throw new InvalidCurrentPasswordError();
    }
    const problem = checkPassword(newPassword, user.username);
    if (problem) throw new PasswordPolicyError(problem);
    if (newPassword === currentPassword) {
      throw new PasswordPolicyError('same_as_current');
    }
    const updated = await this.users.update(user.id, {
      passwordHash: await this.hasher.hash(newPassword),
      mustChangePassword: false,
    });
    await this.sessions.revokeAllForUser(
      user.id,
      this.clock.now(),
      session.sessionId,
    );
    await this.events.record('auth.password_changed', {});
    return toAccount(updated ?? user);
  }

  /** Housekeeping: drops sessions that can no longer authenticate. */
  async purgeDeadSessions(): Promise<number> {
    const now = this.clock.now();
    return this.sessions.deleteDead(
      now,
      new Date(now.getTime() - this.config.sessionIdleMs),
    );
  }

  private isLive({ session, user }: SessionWithUser, now: Date): boolean {
    if (!user.active || session.revokedAt) return false;
    if (session.expiresAt <= now) return false;
    return (
      session.lastActivityAt.getTime() + this.config.sessionIdleMs >
      now.getTime()
    );
  }

  private rejectionReason(
    user: PanelUser | null,
    now: Date,
  ): 'inactive' | 'locked' | null {
    if (!user) return null;
    if (!user.active) return 'inactive';
    if (user.lockedUntil && user.lockedUntil > now) return 'locked';
    return null;
  }

  /** A wrong password: counts the failure and locks the account at the limit. */
  private async registerFailure(user: PanelUser, now: Date): Promise<void> {
    const attempts = await this.users.incrementFailedAttempts(user.id);
    await this.events.record('auth.login_failed', {
      reason: 'bad_password',
      userId: user.id,
    });
    if (attempts < this.config.maxFailedAttempts) return;
    const lockedUntil = new Date(now.getTime() + this.config.lockMs);
    await this.users.update(user.id, { lockedUntil });
    this.logger.warn({ event: 'account_locked', userId: user.id });
    await this.events.record('auth.login_locked', {
      userId: user.id,
      lockedUntil: lockedUntil.toISOString(),
    });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash(DUMMY_PASSWORD);
    return this.dummyHash;
  }
}
