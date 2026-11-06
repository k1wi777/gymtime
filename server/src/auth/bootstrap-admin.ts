import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { EventLogService } from '../common/audit/event-log.service.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import { DuplicateUsernameError } from './domain/panel-user.js';
import { PanelUsersService } from './panel-users.service.js';
import { normalizeUsername } from './username.js';

/**
 * Creates the first administrator from FIRST_ADMIN_USERNAME / _PASSWORD so no
 * database access is needed. It acts only while there are no accounts at all:
 * once any exists the variables are ignored and can be removed.
 */
@Injectable()
export class BootstrapAdmin implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapAdmin.name);

  constructor(
    private readonly accounts: PanelUsersService,
    private readonly events: EventLogService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { firstAdmin } = this.config;
    if (!firstAdmin) return;
    if ((await this.accounts.count()) > 0) {
      this.logger.warn({
        event: 'first_admin_ignored',
        reason: 'accounts already exist; FIRST_ADMIN_* can be removed',
      });
      return;
    }
    try {
      const account = await this.accounts.create({
        name: 'Administrador',
        username: normalizeUsername(firstAdmin.username),
        role: 'admin',
        password: firstAdmin.password,
      });
      this.logger.log({ event: 'first_admin_created', userId: account.id });
      await this.events.record('user.bootstrap_admin', { userId: account.id });
    } catch (error) {
      // Another instance won the race to create it: nothing left to do.
      if (!(error instanceof DuplicateUsernameError)) throw error;
    }
  }
}
