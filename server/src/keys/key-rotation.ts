import { Keyring } from '../fingerprints/crypto/keyring.js';
import {
  TemplateCipher,
  TemplateDecryptionError,
} from '../fingerprints/crypto/template-cipher.service.js';
import type {
  CipherUpdate,
  FingerprintsRepository,
} from '../fingerprints/domain/fingerprints.repository.js';

export interface RotationOptions {
  /** Rows re-encrypted per transaction. */
  batch?: number;
  /** Stop after this many rows (simulates an interruption; resumable). */
  limit?: number;
}

export interface RotationReport {
  rotated: number;
  /** Templates still sealed with an older key version. */
  remaining: number;
  /** Templates per key version after the run. */
  versions: Record<number, number>;
}

export interface VerifyReport {
  checked: number;
  /** Ids of templates the current key alone could not read. */
  failedIds: string[];
}

/** A template cannot be read with any configured key; names its id only. */
export class UnreadableTemplateError extends Error {
  constructor(readonly fingerprintId: string) {
    super(
      `Template ${fingerprintId} cannot be decrypted with the configured keys; rotation stopped (earlier batches are kept)`,
    );
  }
}

const DEFAULT_BATCH = 100;

/**
 * Re-encrypts every template with the current key (R8). The key version of a
 * row is the progress marker, so the job is idempotent, can be interrupted
 * and resumed, and never overwrites a row that a concurrent re-enrolment
 * already sealed with the current key. Never logs plaintext, keys or bytes.
 */
export class KeyRotation {
  private readonly cipher: TemplateCipher;

  constructor(
    private readonly fingerprints: FingerprintsRepository,
    private readonly keyring: Keyring,
  ) {
    this.cipher = new TemplateCipher(keyring);
  }

  async run(options: RotationOptions = {}): Promise<RotationReport> {
    const batch = Math.max(1, options.batch ?? DEFAULT_BATCH);
    const current = this.keyring.currentVersion;
    let rotated = 0;
    for (;;) {
      const left = (options.limit ?? Infinity) - rotated;
      if (left <= 0) break;
      const rows = await this.fingerprints.listNotInKeyVersion(
        current,
        Math.min(batch, left),
      );
      if (rows.length === 0) break;
      const updates: CipherUpdate[] = rows.map((row) => {
        let plain: Buffer;
        try {
          plain = this.cipher.decrypt({
            data: row.template,
            iv: row.iv,
            keyVersion: row.keyVersion,
          });
        } catch (error) {
          if (error instanceof TemplateDecryptionError) {
            throw new UnreadableTemplateError(row.id);
          }
          throw error;
        }
        const sealed = this.cipher.encrypt(plain);
        plain.fill(0);
        return {
          id: row.id,
          fromVersion: row.keyVersion,
          template: sealed.data,
          iv: sealed.iv,
          keyVersion: sealed.keyVersion,
        };
      });
      const updated = await this.fingerprints.replaceCiphertexts(updates);
      rotated += updated;
      // Rows changed under us by another process: stop instead of spinning.
      if (updated === 0) break;
    }
    const versions = await this.fingerprints.countByKeyVersion();
    let remaining = 0;
    for (const [version, count] of versions) {
      if (version !== current) remaining += count;
    }
    return { rotated, remaining, versions: Object.fromEntries(versions) };
  }

  /** Decrypts every template with ONLY the current key. */
  async verify(pageSize = 200): Promise<VerifyReport> {
    const onlyCurrent = new TemplateCipher(
      Keyring.single(this.keyring.current),
    );
    const failedIds: string[] = [];
    let checked = 0;
    let after: string | null = null;
    for (;;) {
      const rows = await this.fingerprints.listAfter(after, pageSize);
      if (rows.length === 0) break;
      for (const row of rows) {
        checked++;
        try {
          if (row.keyVersion !== this.keyring.currentVersion) {
            throw new TemplateDecryptionError();
          }
          onlyCurrent.decrypt({ data: row.template, iv: row.iv });
        } catch {
          failedIds.push(row.id);
        }
      }
      after = rows[rows.length - 1]?.id ?? null;
    }
    return { checked, failedIds };
  }
}
