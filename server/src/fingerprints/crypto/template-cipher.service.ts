import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Keyring } from './keyring.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Mirrors the persisted shape: `data` is ciphertext followed by the GCM tag. */
export interface EncryptedTemplate {
  data: Buffer;
  iv: Buffer;
  /** Version of the key that sealed `data`. */
  keyVersion: number;
}

/** Deliberately carries no bytes of the input, key or plaintext. */
export class TemplateDecryptionError extends Error {
  constructor() {
    super('Template could not be decrypted (corrupt data or wrong key)');
  }
}

/** AES-256-GCM with a fresh random IV per encryption and a versioned key ring. */
@Injectable()
export class TemplateCipher {
  constructor(private readonly keyring: Keyring) {}

  /** Version stamped on everything encrypted from now on. */
  get currentVersion(): number {
    return this.keyring.currentVersion;
  }

  encrypt(plain: Buffer): EncryptedTemplate {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.keyring.current, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return {
      data: Buffer.concat([body, cipher.getAuthTag()]),
      iv,
      keyVersion: this.keyring.currentVersion,
    };
  }

  /**
   * Decrypts with the key of `keyVersion` (the current one when omitted).
   * @throws TemplateDecryptionError on any alteration, a different key or a
   * version without a configured key.
   */
  decrypt(encrypted: {
    data: Buffer;
    iv: Buffer;
    keyVersion?: number;
  }): Buffer {
    const { data, iv } = encrypted;
    const key = this.keyring.keyFor(
      encrypted.keyVersion ?? this.keyring.currentVersion,
    );
    if (!key || iv.length !== IV_BYTES || data.length < TAG_BYTES) {
      throw new TemplateDecryptionError();
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
      return Buffer.concat([
        decipher.update(data.subarray(0, data.length - TAG_BYTES)),
        decipher.final(),
      ]);
    } catch {
      throw new TemplateDecryptionError();
    }
  }
}
