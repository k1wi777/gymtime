import { Logger } from '@nestjs/common';
import { defaultAuthConfig } from './auth.config.js';
import { BootstrapAdmin } from './bootstrap-admin.js';
import { PanelUsersService } from './panel-users.service.js';
import { TEST_PASSWORD, buildAuthFixture, fastHasher } from './testing.js';

const FIRST = { username: ' Admin ', password: 'first-admin-password' };

function build(firstAdmin: typeof FIRST | null = FIRST) {
  const f = buildAuthFixture({ firstAdmin });
  const accounts = new PanelUsersService(f.users, fastHasher);
  const bootstrap = new BootstrapAdmin(accounts, f.eventLog, {
    ...defaultAuthConfig,
    firstAdmin,
  });
  return { f, accounts, bootstrap };
}

describe('BootstrapAdmin (R21)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates an admin who must change the password when there are no accounts', async () => {
    const { f, bootstrap } = build();
    await bootstrap.onApplicationBootstrap();
    const users = await f.users.list();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      username: 'admin',
      role: 'admin',
      active: true,
      mustChangePassword: true,
    });
    const result = await f.service.login({
      username: 'admin',
      password: FIRST.password,
      ip: '1.1.1.1',
    });
    expect(result.account.mustChangePassword).toBe(true);
  });

  it('audits it without the password', async () => {
    const { f, bootstrap } = build();
    await bootstrap.onApplicationBootstrap();
    expect(f.eventLogRepo.entries).toHaveLength(1);
    expect(f.eventLogRepo.entries[0]).toMatchObject({
      type: 'user.bootstrap_admin',
      actor: { type: 'system', id: null },
    });
    expect(JSON.stringify(f.eventLogRepo.entries)).not.toContain(
      FIRST.password,
    );
  });

  it('does not touch existing accounts and warns without values', async () => {
    const { f, bootstrap } = build();
    const existing = await f.createUser('ana', { password: TEST_PASSWORD });
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await bootstrap.onApplicationBootstrap();
    const users = await f.users.list();
    expect(users.map((u) => u.id)).toEqual([existing.id]);
    expect(users[0].passwordHash).toBe(existing.passwordHash);
    expect(f.eventLogRepo.entries).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(FIRST.password);
  });

  it('does nothing without the variables', async () => {
    const { f, bootstrap } = build(null);
    await bootstrap.onApplicationBootstrap();
    expect(await f.users.count()).toBe(0);
  });

  it('is idempotent across restarts', async () => {
    const { f, bootstrap } = build();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await bootstrap.onApplicationBootstrap();
    await bootstrap.onApplicationBootstrap();
    expect(await f.users.count()).toBe(1);
  });
});
