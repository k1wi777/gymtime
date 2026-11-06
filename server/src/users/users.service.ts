import { Injectable } from '@nestjs/common';
import type { Account } from '../auth/account.js';
import { PanelUsersService } from '../auth/panel-users.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { PanelRole } from '../auth/domain/panel-user.js';
import { generateTemporaryPassword } from '../auth/temporary-password.js';
import type { AuthContext } from '../common/auth/auth-context.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { KeyedMutex } from '../common/concurrency/keyed-mutex.js';

export class AccountNotFoundError extends Error {
  constructor() {
    super('Account not found');
  }
}

/** An administrator may not lock themselves out or demote themselves. */
export class SelfChangeError extends Error {
  constructor() {
    super('You cannot deactivate yourself or change your own role');
  }
}

/** The change would leave the system without an active administrator. */
export class LastAdminError extends Error {
  constructor() {
    super(
      'No se puede desactivar ni degradar al último administrador activo: cree o active otro administrador primero',
    );
  }
}

export interface AccountPatch {
  name?: string;
  role?: PanelRole;
  active?: boolean;
}

export interface CreatedAccount {
  account: Account;
  /** Returned once; never stored in clear or audited. */
  temporaryPassword: string;
}

/**
 * Administration of the panel accounts. Every change is audited with the
 * administrator as actor; none of the audit details carries a secret.
 */
@Injectable()
export class UsersService {
  // Counting the administrators and writing must not interleave, or two
  // administrators could deactivate each other at the same time.
  private readonly adminsLock = new KeyedMutex();

  constructor(
    private readonly accounts: PanelUsersService,
    private readonly auth: AuthService,
    private readonly events: EventLogService,
  ) {}

  list(): Promise<Account[]> {
    return this.accounts.list();
  }

  /** @throws DuplicateUsernameError when the username is taken. */
  async create(input: {
    name: string;
    username: string;
    role: PanelRole;
  }): Promise<CreatedAccount> {
    const temporaryPassword = generateTemporaryPassword();
    const account = await this.accounts.create({
      ...input,
      password: temporaryPassword,
    });
    await this.events.record('user.created', {
      userId: account.id,
      role: account.role,
    });
    return { account, temporaryPassword };
  }

  update(
    caller: AuthContext | undefined,
    id: string,
    patch: AccountPatch,
  ): Promise<Account> {
    return this.adminsLock.run('admins', () =>
      this.doUpdate(caller, id, patch),
    );
  }

  private async doUpdate(
    caller: AuthContext | undefined,
    id: string,
    patch: AccountPatch,
  ): Promise<Account> {
    const current = await this.accounts.findById(id);
    if (!current) throw new AccountNotFoundError();

    const isSelf = caller?.kind === 'session' && caller.account.id === id;
    const losesAccess = patch.active === false && current.active;
    const changesRole = patch.role !== undefined && patch.role !== current.role;
    if (isSelf && (losesAccess || changesRole)) throw new SelfChangeError();
    // Applies to the system key too: it may touch other accounts.
    const losesAdmin =
      current.role === 'admin' &&
      current.active &&
      (losesAccess || (changesRole && patch.role !== 'admin'));
    if (losesAdmin && (await this.accounts.countActiveAdmins()) <= 1) {
      throw new LastAdminError();
    }

    const updated = await this.accounts.update(id, patch);
    if (!updated) throw new AccountNotFoundError();

    const edited = [
      ...(patch.name !== undefined && patch.name !== current.name
        ? ['name']
        : []),
      ...(changesRole ? ['role'] : []),
    ];
    if (edited.length > 0) {
      await this.events.record('user.updated', {
        userId: id,
        fields: edited,
        ...(changesRole ? { from: current.role, to: updated.role } : {}),
      });
    }
    if (patch.active !== undefined && patch.active !== current.active) {
      if (!patch.active) await this.auth.revokeUserSessions(id);
      await this.events.record(
        patch.active ? 'user.reactivated' : 'user.deactivated',
        { userId: id },
      );
    }
    return updated;
  }

  /** New temporary password; the old sessions of the account end at once. */
  async resetPassword(id: string): Promise<CreatedAccount> {
    const temporaryPassword = generateTemporaryPassword();
    const account = await this.accounts.resetPassword(id, temporaryPassword);
    if (!account) throw new AccountNotFoundError();
    await this.auth.revokeUserSessions(id);
    await this.events.record('user.password_reset', { userId: id });
    return { account, temporaryPassword };
  }
}
