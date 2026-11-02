import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Mirrors the persisted shape: `data` is ciphertext followed by the GCM tag. */
export interface EncryptedTemplate {
  data: Buffer;
  iv: Buffer;
}

/** Deliberately carries no bytes of the input, key or plaintext. */
export class TemplateDecryptionError extends Error {
  constructor() {
    super('Template could not be decrypted (corrupt data or wrong key)');
  }
}

/** AES-256-GCM with a fresh random IV per encryption. */
@Injectable()
export class TemplateCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.key = Buffer.from(
      config.get('ENCRYPTION_KEY', { infer: true }),
      'base64',
    );
  }

  encrypt(plain: Buffer): EncryptedTemplate {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return { data: Buffer.concat([body, cipher.getAuthTag()]), iv };
  }

  /** @throws TemplateDecryptionError on any alteration or a different key. */
  decrypt(encrypted: EncryptedTemplate): Buffer {
    const { data, iv } = encrypted;
    if (iv.length !== IV_BYTES || data.length < TAG_BYTES) {
      throw new TemplateDecryptionError();
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
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
