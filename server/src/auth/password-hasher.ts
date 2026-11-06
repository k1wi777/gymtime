import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/** Argon2id parameters recommended by OWASP: 19 MiB, 2 passes, 1 lane. */
export interface Argon2Params {
  memoryKiB: number;
  passes: number;
  parallelism: number;
}

export const OWASP_ARGON2_PARAMS: Argon2Params = {
  memoryKiB: 19_456,
  passes: 2,
  parallelism: 1,
};

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const ARGON2_VERSION = 19;
const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Password hashing port. Tests inject a cheap parameter set, not another algorithm. */
export abstract class PasswordHasher {
  abstract hash(password: string): Promise<string>;
  /** Never throws for a malformed hash: it simply does not verify. */
  abstract verify(password: string, hash: string): Promise<boolean>;
}

/**
 * argon2id from `node:crypto` (Node >= 24.7, no dependency), stored in the
 * standard PHC format so the parameters travel with each hash and can be
 * raised later without invalidating old ones.
 */
export class Argon2idPasswordHasher extends PasswordHasher {
  constructor(private readonly params: Argon2Params = OWASP_ARGON2_PARAMS) {
    super();
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const tag = await derive(password, salt, TAG_BYTES, this.params);
    const { memoryKiB, passes, parallelism } = this.params;
    return `$argon2id$v=${ARGON2_VERSION}$m=${memoryKiB},t=${passes},p=${parallelism}$${unpadded(salt)}$${unpadded(tag)}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    const match = PHC_PATTERN.exec(hash);
    if (!match) return false;
    const [, memory, passes, parallelism, salt, expected] = match;
    const expectedTag = Buffer.from(expected, 'base64');
    try {
      const tag = await derive(
        password,
        Buffer.from(salt, 'base64'),
        expectedTag.length,
        {
          memoryKiB: Number(memory),
          passes: Number(passes),
          parallelism: Number(parallelism),
        },
      );
      return timingSafeEqual(tag, expectedTag);
    } catch {
      return false;
    }
  }
}

/** PHC encodes base64 without the `=` padding. */
const unpadded = (buffer: Buffer): string =>
  buffer.toString('base64').split('=')[0];

function derive(
  password: string,
  nonce: Buffer,
  tagLength: number,
  params: Argon2Params,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: password,
        nonce,
        parallelism: params.parallelism,
        tagLength,
        memory: params.memoryKiB,
        passes: params.passes,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}
