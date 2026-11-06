import type { TestingModule } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { auditTestProviders } from '../common/audit/testing.js';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { InMemoryEventLogRepository } from '../common/audit/in-memory-event-log.repository.js';
import { CLOCK, systemClock, type Clock } from '../common/time/clock.js';
import { AuthService } from './auth.service.js';
import {
  AUTH_CONFIG,
  type AuthConfig,
  defaultAuthConfig,
} from './auth.config.js';
import type { PanelRole, PanelUser } from './domain/panel-user.js';
import { InMemorySessionsRepository } from './infrastructure/in-memory-sessions.repository.js';
import { InMemoryUsersRepository } from './infrastructure/in-memory-users.repository.js';
import { SESSIONS_REPOSITORY } from './domain/sessions.repository.js';
import { USERS_REPOSITORY } from './domain/users.repository.js';
import { PanelUsersService } from './panel-users.service.js';
import { Argon2idPasswordHasher, PasswordHasher } from './password-hasher.js';

/** Movable time source for the expiry and lock tests. */
export class TestClock implements Clock {
  private current: Date;

  constructor(start = new Date('2026-11-02T15:00:00Z')) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const minutes = (count: number): number => count * 60_000;
export const hours = (count: number): number => count * 3_600_000;

/** Same argon2id code path as production with a negligible cost. */
export const fastHasher = new Argon2idPasswordHasher({
  memoryKiB: 64,
  passes: 1,
  parallelism: 1,
});

export const TEST_PASSWORD = 'a-good-password-1';

/** Auth module on in-memory repositories, a movable clock and a cheap hasher. */
export function buildAuthFixture(overrides: Partial<AuthConfig> = {}) {
  const clock = new TestClock();
  const config: AuthConfig = { ...defaultAuthConfig, ...overrides };
  const users = new InMemoryUsersRepository();
  const sessions = new InMemorySessionsRepository(users);
  const eventLogRepo = new InMemoryEventLogRepository();
  const eventLog = new EventLogService(eventLogRepo);
  const service = new AuthService(
    users,
    sessions,
    fastHasher,
    clock,
    config,
    eventLog,
  );

  const createUser = async (
    username: string,
    options: {
      role?: PanelRole;
      password?: string;
      mustChangePassword?: boolean;
      active?: boolean;
    } = {},
  ): Promise<PanelUser> => {
    const created = await users.create({
      name: username,
      username,
      passwordHash: await fastHasher.hash(options.password ?? TEST_PASSWORD),
      role: options.role ?? 'asistente',
      mustChangePassword: options.mustChangePassword ?? false,
    });
    if (options.active === false) {
      return (await users.update(created.id, { active: false })) ?? created;
    }
    return created;
  };

  const login = (username: string, password = TEST_PASSWORD, ip = '10.0.0.1') =>
    service.login({ username, password, ip });

  return {
    clock,
    config,
    users,
    sessions,
    eventLogRepo,
    eventLog,
    service,
    createUser,
    login,
  };
}

/**
 * Providers that wire the global guard and its collaborators into a Nest
 * testing module for a controller spec. Put them FIRST in `providers`: a spec
 * that supplies its own `CLOCK` then wins. `x-api-key` equals
 * `defaultAuthConfig.adminApiKey`.
 */
export function authTestProviders(overrides: Partial<AuthConfig> = {}) {
  return [
    ...auditTestProviders,
    { provide: AUTH_CONFIG, useValue: { ...defaultAuthConfig, ...overrides } },
    { provide: CLOCK, useValue: systemClock },
    { provide: USERS_REPOSITORY, useClass: InMemoryUsersRepository },
    {
      provide: SESSIONS_REPOSITORY,
      inject: [USERS_REPOSITORY],
      useFactory: (users: InMemoryUsersRepository) =>
        new InMemorySessionsRepository(users),
    },
    { provide: PasswordHasher, useValue: fastHasher },
    AuthService,
    PanelUsersService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ];
}

export const TEST_ORIGIN = 'http://localhost:3000';

/** Headers a browser panel sends on a mutation. */
export const panelHeaders = (origin = TEST_ORIGIN) => ({
  'x-gymtime-client': 'panel',
  origin,
});

export interface SeedOptions {
  role?: PanelRole;
  password?: string;
  mustChangePassword?: boolean;
  active?: boolean;
}

/** Creates an account straight in the repositories of a testing module. */
export async function seedAccount(
  moduleRef: TestingModule,
  username: string,
  options: SeedOptions = {},
): Promise<PanelUser> {
  const users = moduleRef.get<InMemoryUsersRepository>(USERS_REPOSITORY);
  const created = await users.create({
    name: username,
    username,
    passwordHash: await fastHasher.hash(options.password ?? TEST_PASSWORD),
    role: options.role ?? 'asistente',
    mustChangePassword: options.mustChangePassword ?? false,
  });
  if (options.active === false) {
    await users.update(created.id, { active: false });
  }
  return created;
}

/** The `name=value` part of the session cookie set by a response, or undefined. */
export function sessionCookieOf(headers: {
  'set-cookie'?: string[] | string;
}): string | undefined {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c) => c.startsWith('gt_session='))?.split(';')[0];
}

/** Seeds an account and signs it in; returns the `Cookie` header value. */
export async function signInAs(
  moduleRef: TestingModule,
  username: string,
  role: PanelRole,
): Promise<string> {
  await seedAccount(moduleRef, username, { role });
  const { token } = await moduleRef
    .get<AuthService>(AuthService)
    .login({ username, password: TEST_PASSWORD, ip: '127.0.0.1' });
  return `gt_session=${token}`;
}
