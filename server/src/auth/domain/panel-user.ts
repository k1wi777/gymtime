export const PANEL_ROLES = ['asistente', 'admin'] as const;
export type PanelRole = (typeof PANEL_ROLES)[number];

/** Account of the web panel. `passwordHash` never leaves the auth module. */
export interface PanelUser {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: PanelRole;
  active: boolean;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewPanelUser {
  name: string;
  username: string;
  passwordHash: string;
  role: PanelRole;
  mustChangePassword: boolean;
}

/** Fields that may change after creation. */
export type PanelUserPatch = Partial<
  Pick<
    PanelUser,
    | 'name'
    | 'role'
    | 'active'
    | 'passwordHash'
    | 'mustChangePassword'
    | 'lockedUntil'
    | 'lastLoginAt'
  > & { failedAttempts: number }
>;

export class DuplicateUsernameError extends Error {
  constructor() {
    super('Username already exists');
  }
}
