import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import {
  TemplateCipher,
  TemplateDecryptionError,
} from './template-cipher.service.js';

const cipherWith = (key: Buffer) =>
  new TemplateCipher({
    get: () => key.toString('base64'),
  } as unknown as ConfigService<Env, true>);

describe('TemplateCipher', () => {
  const cipher = cipherWith(randomBytes(32));
  const plain = randomBytes(512);

  it('round-trips a template and never stores it in clear', () => {
    const encrypted = cipher.encrypt(plain);
    expect(cipher.decrypt(encrypted).equals(plain)).toBe(true);
    expect(encrypted.data.includes(plain.subarray(0, 32))).toBe(false);
    expect(encrypted.data.length).toBe(plain.length + 16);
  });

  it('uses a different IV for every encryption', () => {
    const a = cipher.encrypt(plain);
    const b = cipher.encrypt(plain);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.data.equals(b.data)).toBe(false);
  });

  const flip = (buffer: Buffer, index: number) => {
    const copy = Buffer.from(buffer);
    copy[index] = (copy[index] ?? 0) ^ 0x01;
    return copy;
  };

  it('fails when one byte of the ciphertext, tag or IV changes', () => {
    const { data, iv } = cipher.encrypt(plain);
    const tagStart = data.length - 16;
    for (const altered of [
      { data: flip(data, 0), iv },
      { data: flip(data, tagStart - 1), iv },
      { data: flip(data, tagStart), iv },
      { data: flip(data, data.length - 1), iv },
      { data, iv: flip(iv, 0) },
    ]) {
      expect(() => cipher.decrypt(altered)).toThrow(TemplateDecryptionError);
    }
  });

  it('fails with another key and with truncated input', () => {
    const encrypted = cipher.encrypt(plain);
    expect(() => cipherWith(randomBytes(32)).decrypt(encrypted)).toThrow(
      TemplateDecryptionError,
    );
    expect(() =>
      cipher.decrypt({ data: encrypted.data.subarray(0, 5), iv: encrypted.iv }),
    ).toThrow(TemplateDecryptionError);
  });

  it('does not leak data in the error message', () => {
    const { data, iv } = cipher.encrypt(plain);
    try {
      cipher.decrypt({ data: flip(data, 0), iv });
    } catch (error) {
      expect((error as Error).message).not.toContain(data.toString('base64'));
    }
  });
});
