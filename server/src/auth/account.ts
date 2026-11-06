import type { PanelRole, PanelUser } from './domain/panel-user.js';

/** What the rest of the system may know of an account: never hash or counters. */
export interface Account {
  id: string;
  name: string;
  username: string;
  role: PanelRole;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export function toAccount(user: PanelUser): Account {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}
