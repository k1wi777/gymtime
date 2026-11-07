/** Settings that define the key ring; a subset of the validated environment. */
export interface KeyringSettings {
  ENCRYPTION_KEY: string;
  ENCRYPTION_KEY_VERSION: number;
  ENCRYPTION_KEYS_RETIRED: ReadonlyArray<{ version: number; key: string }>;
}

/**
 * Encryption keys by version. The current key encrypts; any version can
 * decrypt. Never logged or serialised: it holds key material.
 */
export class Keyring {
  private readonly keys = new Map<number, Buffer>();

  constructor(
    readonly currentVersion: number,
    current: Buffer,
    retired: ReadonlyArray<{ version: number; key: Buffer }> = [],
  ) {
    this.keys.set(currentVersion, current);
    for (const { version, key } of retired) this.keys.set(version, key);
  }

  static fromSettings(settings: KeyringSettings): Keyring {
    return new Keyring(
      settings.ENCRYPTION_KEY_VERSION,
      Buffer.from(settings.ENCRYPTION_KEY, 'base64'),
      settings.ENCRYPTION_KEYS_RETIRED.map(({ version, key }) => ({
        version,
        key: Buffer.from(key, 'base64'),
      })),
    );
  }

  /** Version 1 with a single key: the layout before H11 (and most tests). */
  static single(key: Buffer): Keyring {
    return new Keyring(1, key);
  }

  get current(): Buffer {
    return this.keys.get(this.currentVersion) as Buffer;
  }

  keyFor(version: number): Buffer | undefined {
    return this.keys.get(version);
  }

  has(version: number): boolean {
    return this.keys.has(version);
  }

  /** Versions that can be read, ascending. Never their keys. */
  versions(): number[] {
    return [...this.keys.keys()].sort((a, b) => a - b);
  }

  toJSON(): string {
    return `Keyring(current=${this.currentVersion}, versions=${this.versions().join(',')})`;
  }
}
