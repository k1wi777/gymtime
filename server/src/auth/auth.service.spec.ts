import { hashToken } from './auth.service.js';
import {
  InvalidCredentialsError,
  InvalidCurrentPasswordError,
  LoginRateLimitedError,
  PasswordPolicyError,
} from './auth.errors.js';
import { TEST_PASSWORD, buildAuthFixture, hours, minutes } from './testing.js';

describe('AuthService login (R1, R2, R8)', () => {
  it('creates a revocable session and stores only the token hash', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana', { role: 'admin' });
    const result = await f.login('ana');
    expect(result.account).toMatchObject({ username: 'ana', role: 'admin' });
    expect(result.maxAgeMs).toBe(hours(8));
    expect(f.sessions.tokenHashes()).toEqual([hashToken(result.token)]);
    expect(f.sessions.tokenHashes()).not.toContain(result.token);
    expect(await f.service.authenticate(result.token)).toMatchObject({
      account: { username: 'ana' },
    });
  });

  it('normalizes the username', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana');
    await expect(f.login('  ANA ')).resolves.toBeDefined();
  });

  it('gives the same error for unknown, wrong password, inactive and locked', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana');
    await f.createUser('off', { active: false });
    const failures: unknown[] = [];
    for (const [user, password] of [
      ['ghost', TEST_PASSWORD],
      ['ana', 'wrong-password-1'],
      ['off', TEST_PASSWORD],
    ] as const) {
      failures.push(await f.login(user, password).catch((e: unknown) => e));
    }
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(InvalidCredentialsError);
      expect((failure as Error).message).toBe('Invalid credentials');
    }
  });

  it('verifies a password even when the user does not exist', async () => {
    const f = buildAuthFixture();
    const verify = vi.spyOn(
      (f.service as unknown as { hasher: { verify: () => Promise<boolean> } })
        .hasher,
      'verify',
    );
    await f.login('ghost').catch(() => undefined);
    expect(verify).toHaveBeenCalledTimes(1);
    verify.mockRestore();
  });

  it('audits success and failure without secrets or the typed username', async () => {
    const f = buildAuthFixture();
    const ana = await f.createUser('ana');
    await f.login('typo-user').catch(() => undefined);
    await f.login('ana', 'wrong-password-1').catch(() => undefined);
    await f.login('ana');
    const entries = f.eventLogRepo.entries;
    expect(entries.map((e) => e.type)).toEqual([
      'auth.login_failed',
      'auth.login_failed',
      'auth.login_ok',
    ]);
    expect(entries[2].actor).toEqual({ type: 'user', id: ana.id });
    const text = JSON.stringify(entries);
    for (const secret of [
      'typo-user',
      'wrong-password-1',
      TEST_PASSWORD,
      'argon2',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('AuthService lock (R9)', () => {
  it('locks on the 5th consecutive failure and rejects even the right password', async () => {
    const f = buildAuthFixture({ loginRateLimit: 100 });
    const ana = await f.createUser('ana');
    for (let i = 0; i < 5; i += 1) {
      await f.login('ana', 'wrong-password-1').catch(() => undefined);
    }
    expect((await f.users.findById(ana.id))?.lockedUntil).toEqual(
      new Date(f.clock.now().getTime() + minutes(15)),
    );
    await expect(f.login('ana')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(f.eventLogRepo.entries.map((e) => e.type)).toContain(
      'auth.login_locked',
    );
  });

  it('does not extend the lock with attempts made while locked', async () => {
    const f = buildAuthFixture({ loginRateLimit: 100 });
    const ana = await f.createUser('ana');
    for (let i = 0; i < 5; i += 1) {
      await f.login('ana', 'wrong-password-1').catch(() => undefined);
    }
    const lockedUntil = (await f.users.findById(ana.id))?.lockedUntil;
    f.clock.advance(minutes(5));
    await f.login('ana', 'wrong-password-1').catch(() => undefined);
    const after = await f.users.findById(ana.id);
    expect(after?.lockedUntil).toEqual(lockedUntil);
    expect(after?.failedAttempts).toBe(5);
  });

  it('unlocks after 15 minutes and resets the counter on success', async () => {
    const f = buildAuthFixture({ loginRateLimit: 100 });
    const ana = await f.createUser('ana');
    for (let i = 0; i < 5; i += 1) {
      await f.login('ana', 'wrong-password-1').catch(() => undefined);
    }
    f.clock.advance(minutes(15));
    await expect(f.login('ana')).resolves.toBeDefined();
    expect(await f.users.findById(ana.id)).toMatchObject({
      failedAttempts: 0,
      lockedUntil: null,
    });
  });

  it('resets the counter on a success before the limit', async () => {
    const f = buildAuthFixture({ loginRateLimit: 100 });
    const ana = await f.createUser('ana');
    for (let i = 0; i < 4; i += 1) {
      await f.login('ana', 'wrong-password-1').catch(() => undefined);
    }
    await f.login('ana');
    expect((await f.users.findById(ana.id))?.failedAttempts).toBe(0);
  });
});

describe('AuthService rate limit (R10)', () => {
  it('answers 429 data after the limit and evaluates nothing', async () => {
    const f = buildAuthFixture({ loginRateLimit: 3 });
    await f.createUser('ana');
    for (let i = 0; i < 3; i += 1) {
      await f.login('ana', 'wrong-password-1').catch(() => undefined);
    }
    const blocked = await f.login('ana').catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(LoginRateLimitedError);
    expect(
      (blocked as LoginRateLimitedError).retryAfterSeconds,
    ).toBeGreaterThan(0);
    await f.login('ana').catch(() => undefined);
    // Audited once per window, not once per rejected request.
    expect(
      f.eventLogRepo.entries.filter(
        (e) => e.type === 'auth.login_rate_limited',
      ),
    ).toHaveLength(1);
  });

  it('counts per IP and recovers with the next window', async () => {
    const f = buildAuthFixture({ loginRateLimit: 1 });
    await f.createUser('ana');
    await f.login('ana', TEST_PASSWORD, '1.1.1.1');
    await expect(
      f.login('ana', TEST_PASSWORD, '1.1.1.1'),
    ).rejects.toBeInstanceOf(LoginRateLimitedError);
    await expect(
      f.login('ana', TEST_PASSWORD, '2.2.2.2'),
    ).resolves.toBeDefined();
    f.clock.advance(60_000);
    await expect(
      f.login('ana', TEST_PASSWORD, '1.1.1.1'),
    ).resolves.toBeDefined();
  });
});

describe('AuthService sessions (R2, R3)', () => {
  it('expires after 30 minutes without activity', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana');
    const { token } = await f.login('ana');
    f.clock.advance(minutes(29));
    expect(await f.service.authenticate(token)).not.toBeNull();
    f.clock.advance(minutes(30));
    expect(await f.service.authenticate(token)).toBeNull();
  });

  it('keeps a session alive with activity but dies at 8 hours', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana');
    const { token } = await f.login('ana');
    for (let i = 0; i < 15; i += 1) {
      f.clock.advance(minutes(25));
      expect(await f.service.authenticate(token)).not.toBeNull();
    }
    f.clock.advance(minutes(25));
    f.clock.advance(minutes(25));
    expect(await f.service.authenticate(token)).toBeNull();
  });

  it('writes last_activity_at at most once a minute', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana');
    const { token } = await f.login('ana');
    const touch = vi.spyOn(f.sessions, 'touch');
    await f.service.authenticate(token);
    f.clock.advance(30_000);
    await f.service.authenticate(token);
    expect(touch).not.toHaveBeenCalled();
    f.clock.advance(31_000);
    await f.service.authenticate(token);
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown tokens and sessions of deactivated accounts', async () => {
    const f = buildAuthFixture();
    const ana = await f.createUser('ana');
    expect(await f.service.authenticate('nope')).toBeNull();
    const { token } = await f.login('ana');
    await f.users.update(ana.id, { active: false });
    expect(await f.service.authenticate(token)).toBeNull();
  });

  it('logout revokes the session and audits it', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana');
    const { token } = await f.login('ana');
    const session = await f.service.authenticate(token);
    await f.service.logout(session!.sessionId);
    expect(await f.service.authenticate(token)).toBeNull();
    expect(f.eventLogRepo.entries.map((e) => e.type)).toContain('auth.logout');
  });

  it('isSessionActive does not renew the idle timer', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana');
    const { token } = await f.login('ana');
    const session = (await f.service.authenticate(token))!;
    f.clock.advance(minutes(20));
    expect(await f.service.isSessionActive(session.sessionId)).toBe(true);
    f.clock.advance(minutes(11));
    expect(await f.service.isSessionActive(session.sessionId)).toBe(false);
  });

  it('purges dead sessions only', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana');
    const old = await f.login('ana');
    f.clock.advance(minutes(40));
    const fresh = await f.login('ana');
    expect(await f.service.purgeDeadSessions()).toBe(1);
    expect(await f.service.authenticate(old.token)).toBeNull();
    expect(await f.service.authenticate(fresh.token)).not.toBeNull();
  });
});

describe('AuthService changePassword (R5, R7)', () => {
  it('changes the password, clears the flag and revokes the other sessions', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana', { mustChangePassword: true });
    const first = await f.login('ana');
    const second = await f.login('ana');
    const session = (await f.service.authenticate(second.token))!;
    const account = await f.service.changePassword(
      session,
      TEST_PASSWORD,
      'another-good-password',
    );
    expect(account.mustChangePassword).toBe(false);
    expect(await f.service.authenticate(first.token)).toBeNull();
    expect(await f.service.authenticate(second.token)).not.toBeNull();
    await expect(f.login('ana')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(
      f.login('ana', 'another-good-password'),
    ).resolves.toBeDefined();
    expect(JSON.stringify(f.eventLogRepo.entries)).not.toContain(
      'another-good',
    );
  });

  it('rejects a wrong current password, a weak one and the same one', async () => {
    const f = buildAuthFixture();
    await f.createUser('ana');
    const session = (await f.service.authenticate(
      (await f.login('ana')).token,
    ))!;
    await expect(
      f.service.changePassword(
        session,
        'nope-nope-nope',
        'another-good-password',
      ),
    ).rejects.toBeInstanceOf(InvalidCurrentPasswordError);
    await expect(
      f.service.changePassword(session, TEST_PASSWORD, 'short'),
    ).rejects.toMatchObject({ problem: 'too_short' });
    await expect(
      f.service.changePassword(session, TEST_PASSWORD, TEST_PASSWORD),
    ).rejects.toMatchObject({ problem: 'same_as_current' });
    await expect(
      f.service.changePassword(session, TEST_PASSWORD, 'ANA'),
    ).rejects.toBeInstanceOf(PasswordPolicyError);
  });
});
