import { Inject, Injectable } from '@nestjs/common';
import { type Account, toAccount } from './account.js';
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from './domain/users.repository.js';
import type { PanelRole } from './domain/panel-user.js';
import { PasswordHasher } from './password-hasher.js';

export interface CreateAccountInput {
  name: string;
  username: string;
  role: PanelRole;
  password: string;
}

/**
 * Account storage for the `users` module and the bootstrap: the only way out
 * of the auth module's user repository, always as hash-free `Account` views.
 * Username and password rules are checked by the callers.
 */
@Injectable()
export class PanelUsersService {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  count(): Promise<number> {
    return this.users.count();
  }

  async list(): Promise<Account[]> {
    return (await this.users.list()).map(toAccount);
  }

  /** Active administrators; the system must never reach zero. */
  async countActiveAdmins(): Promise<number> {
    return (await this.users.list()).filter(
      (user) => user.role === 'admin' && user.active,
    ).length;
  }

  /** Accounts by id (audit trail names), in one query's worth of data. */
  async findByIds(ids: string[]): Promise<Account[]> {
    const wanted = new Set(ids);
    return (await this.users.list())
      .filter((user) => wanted.has(user.id))
      .map(toAccount);
  }

  async findById(id: string): Promise<Account | null> {
    const user = await this.users.findById(id);
    return user ? toAccount(user) : null;
  }

  /** The password is temporary: the owner must change it on first sign-in. */
  async create(input: CreateAccountInput): Promise<Account> {
    const user = await this.users.create({
      name: input.name,
      username: input.username,
      passwordHash: await this.hasher.hash(input.password),
      role: input.role,
      mustChangePassword: true,
    });
    return toAccount(user);
  }

  async update(
    id: string,
    patch: { name?: string; role?: PanelRole; active?: boolean },
  ): Promise<Account | null> {
    const user = await this.users.update(id, patch);
    return user ? toAccount(user) : null;
  }

  /** Sets a temporary password and lifts any lock, as an admin reset does. */
  async resetPassword(id: string, password: string): Promise<Account | null> {
    const user = await this.users.update(id, {
      passwordHash: await this.hasher.hash(password),
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: null,
    });
    return user ? toAccount(user) : null;
  }
}
