import { randomUUID } from 'node:crypto';
import {
  DuplicateUsernameError,
  type NewPanelUser,
  type PanelUser,
  type PanelUserPatch,
} from '../domain/panel-user.js';
import type { UsersRepository } from '../domain/users.repository.js';

export class InMemoryUsersRepository implements UsersRepository {
  private readonly users = new Map<string, PanelUser>();

  count(): Promise<number> {
    return Promise.resolve(this.users.size);
  }

  findById(id: string): Promise<PanelUser | null> {
    return Promise.resolve(this.copy(this.users.get(id)));
  }

  findByUsername(username: string): Promise<PanelUser | null> {
    const found = [...this.users.values()].find(
      (user) => user.username === username,
    );
    return Promise.resolve(this.copy(found));
  }

  list(): Promise<PanelUser[]> {
    const sorted = [...this.users.values()].sort((a, b) =>
      a.username.localeCompare(b.username),
    );
    return Promise.resolve(sorted.map((user) => ({ ...user })));
  }

  create(data: NewPanelUser): Promise<PanelUser> {
    const taken = [...this.users.values()].some(
      (user) => user.username === data.username,
    );
    if (taken) return Promise.reject(new DuplicateUsernameError());
    const now = new Date();
    const user: PanelUser = {
      id: randomUUID(),
      ...data,
      active: true,
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return Promise.resolve({ ...user });
  }

  update(id: string, patch: PanelUserPatch): Promise<PanelUser | null> {
    const user = this.users.get(id);
    if (!user) return Promise.resolve(null);
    Object.assign(user, patch, { updatedAt: new Date() });
    return Promise.resolve({ ...user });
  }

  incrementFailedAttempts(id: string): Promise<number> {
    const user = this.users.get(id);
    if (!user) return Promise.resolve(0);
    user.failedAttempts += 1;
    return Promise.resolve(user.failedAttempts);
  }

  private copy(user: PanelUser | undefined): PanelUser | null {
    return user ? { ...user } : null;
  }
}
