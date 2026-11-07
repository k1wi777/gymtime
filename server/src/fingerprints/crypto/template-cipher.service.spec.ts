import { randomBytes } from 'node:crypto';
import { Keyring } from './keyring.js';
import {
  TemplateCipher,
  TemplateDecryptionError,
} from './template-cipher.service.js';

const cipherWith = (key: Buffer) => new TemplateCipher(Keyring.single(key));

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

  describe('key versions (H11)', () => {
    const [k1, k2, k3] = [randomBytes(32), randomBytes(32), randomBytes(32)];
    const ring = (current: number, retired: Array<[number, Buffer]>) =>
      new TemplateCipher(
        new Keyring(
          current,
          { 1: k1, 2: k2, 3: k3 }[current] as Buffer,
          retired.map(([version, key]) => ({ version, key })),
        ),
      );

    it('stamps the current version and decrypts three generations with their own key', () => {
      const v1 = ring(1, []).encrypt(plain);
      const v2 = ring(2, [[1, k1]]).encrypt(plain);
      const reader = ring(3, [
        [1, k1],
        [2, k2],
      ]);
      const v3 = reader.encrypt(plain);
      expect([v1.keyVersion, v2.keyVersion, v3.keyVersion]).toEqual([1, 2, 3]);
      for (const sealed of [v1, v2, v3]) {
        expect(reader.decrypt(sealed).equals(plain)).toBe(true);
      }
    });

    it('fails without leaking when the key of a version is missing', () => {
      const v1 = ring(1, []).encrypt(plain);
      const reader = ring(2, []);
      expect(() => reader.decrypt(v1)).toThrow(TemplateDecryptionError);
      try {
        reader.decrypt(v1);
      } catch (error) {
        expect((error as Error).message).not.toMatch(/[A-Za-z0-9+/]{20,}/);
      }
    });

    it('does not decrypt with the key of another version', () => {
      const v1 = ring(1, []).encrypt(plain);
      const wrong = ring(2, [[1, k2]]);
      expect(() => wrong.decrypt(v1)).toThrow(TemplateDecryptionError);
    });

    it('the key ring never serialises key material', () => {
      const text = JSON.stringify(
        new Keyring(2, k2, [{ version: 1, key: k1 }]),
      );
      expect(text).toBe('"Keyring(current=2, versions=1,2)"');
    });
  });
});
