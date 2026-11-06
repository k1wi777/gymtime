import type { NewPanelUser, PanelUser, PanelUserPatch } from './panel-user.js';

export interface UsersRepository {
  count(): Promise<number>;
  findById(id: string): Promise<PanelUser | null>;
  /** `username` is already normalized. */
  findByUsername(username: string): Promise<PanelUser | null>;
  list(): Promise<PanelUser[]>;
  /** @throws DuplicateUsernameError */
  create(data: NewPanelUser): Promise<PanelUser>;
  update(id: string, patch: PanelUserPatch): Promise<PanelUser | null>;
  /** Atomically adds one failed attempt and returns the new counter. */
  incrementFailedAttempts(id: string): Promise<number>;
}

export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');
