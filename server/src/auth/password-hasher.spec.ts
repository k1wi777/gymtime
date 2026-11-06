import {
  Argon2idPasswordHasher,
  OWASP_ARGON2_PARAMS,
} from './password-hasher.js';

const cheap = new Argon2idPasswordHasher({
  memoryKiB: 64,
  passes: 1,
  parallelism: 1,
});

describe('Argon2idPasswordHasher (R5)', () => {
  it('writes the standard PHC format with the parameters', async () => {
    const hash = await cheap.hash('correct horse battery');
    expect(hash).toMatch(
      /^\$argon2id\$v=19\$m=64,t=1,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await cheap.hash('correct horse battery');
    await expect(cheap.verify('correct horse battery', hash)).resolves.toBe(
      true,
    );
    await expect(cheap.verify('correct horse batterz', hash)).resolves.toBe(
      false,
    );
  });

  it('uses a different salt for every hash', async () => {
    const [a, b] = await Promise.all([cheap.hash('same'), cheap.hash('same')]);
    expect(a).not.toBe(b);
  });

  it('reads the parameters from the hash, not from the hasher', async () => {
    const hash = await cheap.hash('portable password');
    const other = new Argon2idPasswordHasher({
      memoryKiB: 128,
      passes: 3,
      parallelism: 1,
    });
    await expect(other.verify('portable password', hash)).resolves.toBe(true);
  });

  it.each(['', 'plain', '$argon2id$v=19$m=64,t=1,p=1$abc', '$argon2i$v=19$x'])(
    'does not verify the malformed hash %j',
    async (hash) => {
      await expect(cheap.verify('whatever password', hash)).resolves.toBe(
        false,
      );
    },
  );

  it('defaults to the OWASP parameters and works with them', async () => {
    expect(OWASP_ARGON2_PARAMS).toEqual({
      memoryKiB: 19_456,
      passes: 2,
      parallelism: 1,
    });
    const real = new Argon2idPasswordHasher();
    const hash = await real.hash('a real password');
    expect(hash).toContain('$argon2id$v=19$m=19456,t=2,p=1$');
    await expect(real.verify('a real password', hash)).resolves.toBe(true);
  });
});
