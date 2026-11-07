import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Keyring } from './keyring.js';
import {
  FINGERPRINTS_REPOSITORY,
  type FingerprintsRepository,
} from '../domain/fingerprints.repository.js';

/** A stored template needs a key version that is not configured. */
export class MissingKeyVersionError extends Error {
  constructor(readonly versions: number[]) {
    super(
      `Templates are stored with encryption key version(s) ${versions.join(', ')} ` +
        'but no key is configured for them: add them to ENCRYPTION_KEYS_RETIRED ' +
        '("<version>:<base64>"). Refusing to start so no sync fails later.',
    );
  }
}

/**
 * Refuses to start when the database holds templates sealed with a key
 * version this process cannot read (R9). It names versions, never keys.
 */
@Injectable()
export class KeyringGuard implements OnModuleInit {
  private readonly logger = new Logger(KeyringGuard.name);

  constructor(
    private readonly keyring: Keyring,
    @Inject(FINGERPRINTS_REPOSITORY)
    private readonly fingerprints: FingerprintsRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const counts = await this.fingerprints.countByKeyVersion();
    const missing = [...counts.keys()].filter((v) => !this.keyring.has(v));
    if (missing.length > 0) {
      throw new MissingKeyVersionError(missing.sort((a, b) => a - b));
    }
    const old = [...counts].filter(([v]) => v !== this.keyring.currentVersion);
    if (old.length > 0) {
      this.logger.warn({
        event: 'templates_on_old_key',
        currentVersion: this.keyring.currentVersion,
        pending: Object.fromEntries(old),
        hint: 'run `npm run keys:rotate -w server`',
      });
    }
  }
}
