import { DuplicateUsernameError } from '../domain/panel-user.js';
import { InMemorySessionsRepository } from './in-memory-sessions.repository.js';
import { InMemoryUsersRepository } from './in-memory-users.repository.js';

const newUser = (username: string) => ({
  name: username,
  username,
  passwordHash: 'hash',
  role: 'asistente' as const,
  mustChangePassword: true,
});

describe('in-memory users and sessions repositories', () => {
  const t0 = new Date('2026-11-02T10:00:00Z');
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  it('rejects a duplicate username and counts failures atomically', async () => {
    const users = new InMemoryUsersRepository();
    const ana = await users.create(newUser('ana'));
    await expect(users.create(newUser('ana'))).rejects.toThrow(
      DuplicateUsernameError,
    );
    expect(await users.incrementFailedAttempts(ana.id)).toBe(1);
    expect(await users.incrementFailedAttempts(ana.id)).toBe(2);
    expect(
      (await users.update(ana.id, { failedAttempts: 0 }))?.failedAttempts,
    ).toBe(0);
    expect(await users.update('missing', { name: 'x' })).toBeNull();
  });

  it('finds sessions by token hash and revokes them', async () => {
    const users = new InMemoryUsersRepository();
    const ana = await users.create(newUser('ana'));
    const sessions = new InMemorySessionsRepository(users);
    const first = await sessions.create({
      userId: ana.id,
      tokenHash: 'h1',
      now: t0,
      expiresAt: at(480),
    });
    const second = await sessions.create({
      userId: ana.id,
      tokenHash: 'h2',
      now: t0,
      expiresAt: at(480),
    });
    expect((await sessions.findByTokenHash('h1'))?.user.username).toBe('ana');
    expect(await sessions.findByTokenHash('nope')).toBeNull();
    expect(await sessions.revokeAllForUser(ana.id, at(1), second.id)).toBe(1);
    expect((await sessions.findById(first.id))?.session.revokedAt).toEqual(
      at(1),
    );
    expect((await sessions.findById(second.id))?.session.revokedAt).toBeNull();
  });

  it('deletes revoked, expired and idle sessions only', async () => {
    const users = new InMemoryUsersRepository();
    const ana = await users.create(newUser('ana'));
    const sessions = new InMemorySessionsRepository(users);
    const make = (tokenHash: string, expires: number) =>
      sessions.create({
        userId: ana.id,
        tokenHash,
        now: t0,
        expiresAt: at(expires),
      });
    const live = await make('live', 480);
    const revoked = await make('revoked', 480);
    await make('expired', 5);
    const idle = await make('idle', 480);
    await sessions.revoke(revoked.id, at(1));
    await sessions.touch(live.id, at(40));
    expect(await sessions.deleteDead(at(40), at(10))).toBe(3);
    expect(await sessions.findById(live.id)).not.toBeNull();
    expect(await sessions.findById(idle.id)).toBeNull();
  });
});
