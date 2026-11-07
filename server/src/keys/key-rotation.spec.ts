import { randomBytes } from 'node:crypto';
import { Keyring } from '../fingerprints/crypto/keyring.js';
import { KeyringGuard } from '../fingerprints/crypto/keyring.guard.js';
import { MissingKeyVersionError } from '../fingerprints/crypto/keyring.guard.js';
import { TemplateCipher } from '../fingerprints/crypto/template-cipher.service.js';
import { InMemoryFingerprintsRepository } from '../fingerprints/infrastructure/in-memory-fingerprints.repository.js';
import { KeyRotation, UnreadableTemplateError } from './key-rotation.js';

const K1 = randomBytes(32);
const K2 = randomBytes(32);
const K3 = randomBytes(32);
const ring1 = Keyring.single(K1);
const ring2 = new Keyring(2, K2, [{ version: 1, key: K1 }]);
const ring3 = new Keyring(3, K3, [
  { version: 1, key: K1 },
  { version: 2, key: K2 },
]);

const sealedOf = (row: {
  template: Buffer;
  iv: Buffer;
  keyVersion: number;
}) => ({
  data: row.template,
  iv: row.iv,
  keyVersion: row.keyVersion,
});

/** N templates sealed with `ring`; returns their plaintexts by student id. */
function seed(repo: InMemoryFingerprintsRepository, ring: Keyring, n: number) {
  const cipher = new TemplateCipher(ring);
  const plains = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    const plain = randomBytes(512);
    const sealed = cipher.encrypt(plain);
    repo.replaceActive(`s${i}`, sealed.data, sealed.iv, sealed.keyVersion);
    plains.set(`s${i}`, plain);
  }
  return plains;
}

async function expectAllReadable(
  repo: InMemoryFingerprintsRepository,
  ring: Keyring,
  plains: Map<string, Buffer>,
) {
  const cipher = new TemplateCipher(ring);
  for (const row of repo.all()) {
    expect(
      cipher.decrypt(sealedOf(row)).equals(plains.get(row.studentId)!),
    ).toBe(true);
  }
}

describe('KeyRotation (R8)', () => {
  it('re-encrypts in batches without losing any template', async () => {
    const repo = new InMemoryFingerprintsRepository();
    const plains = seed(repo, ring1, 25);
    const report = await new KeyRotation(repo, ring2).run({ batch: 10 });
    expect(report).toEqual({ rotated: 25, remaining: 0, versions: { 2: 25 } });
    expect(repo.all().every((f) => f.keyVersion === 2)).toBe(true);
    await expectAllReadable(repo, new Keyring(2, K2), plains); // the current key alone
  });

  it('can be interrupted and resumed, then repeated with no effect', async () => {
    const repo = new InMemoryFingerprintsRepository();
    const plains = seed(repo, ring1, 12);
    const rotation = new KeyRotation(repo, ring2);
    const first = await rotation.run({ batch: 5, limit: 7 });
    expect(first).toMatchObject({ rotated: 7, remaining: 5 });
    await expectAllReadable(repo, ring2, plains); // mixed state is readable
    const second = await rotation.run({ batch: 5 });
    expect(second).toMatchObject({ rotated: 5, remaining: 0 });
    const third = await rotation.run();
    expect(third).toMatchObject({ rotated: 0, remaining: 0 });
    await expectAllReadable(repo, ring2, plains);
  });

  it('handles three generations at once', async () => {
    const repo = new InMemoryFingerprintsRepository();
    const plains = seed(repo, ring1, 4);
    for (const [i, row] of [...repo.all()].entries()) {
      if (i % 2 === 0) continue;
      const plain = plains.get(row.studentId)!;
      const sealed = new TemplateCipher(ring2).encrypt(plain);
      await repo.replaceCiphertexts([
        {
          id: row.id,
          fromVersion: 1,
          template: sealed.data,
          iv: sealed.iv,
          keyVersion: 2,
        },
      ]);
    }
    const report = await new KeyRotation(repo, ring3).run();
    expect(report).toMatchObject({
      rotated: 4,
      remaining: 0,
      versions: { 3: 4 },
    });
    await expectAllReadable(repo, ring3, plains);
  });

  it('does not overwrite a row that a concurrent write already sealed with the current key', async () => {
    const repo = new InMemoryFingerprintsRepository();
    seed(repo, ring1, 1);
    const [row] = repo.all();
    const fresh = new TemplateCipher(ring2).encrypt(
      Buffer.from('new template'),
    );
    repo.replaceActive(row!.studentId, fresh.data, fresh.iv, 2);
    const updated = await repo.replaceCiphertexts([
      {
        id: row!.id,
        fromVersion: 1,
        template: Buffer.alloc(32),
        iv: Buffer.alloc(12),
        keyVersion: 2,
      },
    ]);
    expect(updated).toBe(0);
    const [after] = repo.all();
    expect(new TemplateCipher(ring2).decrypt(sealedOf(after!)).toString()).toBe(
      'new template',
    );
  });

  it('stops naming the id (never bytes) when a template is unreadable', async () => {
    const repo = new InMemoryFingerprintsRepository();
    seed(repo, ring1, 1);
    const wrongRing = new Keyring(2, K2, [
      { version: 1, key: randomBytes(32) },
    ]);
    await expect(new KeyRotation(repo, wrongRing).run()).rejects.toBeInstanceOf(
      UnreadableTemplateError,
    );
  });

  it('--verify decrypts everything with the current key alone', async () => {
    const repo = new InMemoryFingerprintsRepository();
    seed(repo, ring1, 6);
    const rotation = new KeyRotation(repo, ring2);
    expect((await rotation.verify()).failedIds).toHaveLength(6); // not rotated yet
    await rotation.run();
    expect(await rotation.verify(4)).toEqual({ checked: 6, failedIds: [] });
  });
});

describe('KeyringGuard (R9)', () => {
  it('refuses to start naming the missing versions, not keys', async () => {
    const repo = new InMemoryFingerprintsRepository();
    seed(repo, ring1, 1);
    const guard = new KeyringGuard(new Keyring(2, K2), repo);
    const error = await guard.onModuleInit().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingKeyVersionError);
    expect((error as MissingKeyVersionError).versions).toEqual([1]);
    expect((error as Error).message).toContain('version(s) 1');
    expect((error as Error).message).not.toContain(K1.toString('base64'));
  });

  it('starts when every stored version has its key, or the table is empty', async () => {
    const repo = new InMemoryFingerprintsRepository();
    await expect(
      new KeyringGuard(ring2, repo).onModuleInit(),
    ).resolves.toBeUndefined();
    seed(repo, ring1, 2);
    await expect(
      new KeyringGuard(ring2, repo).onModuleInit(),
    ).resolves.toBeUndefined();
  });
});
