import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PgLeaderLock } from '../common/concurrency/pg-leader-lock.js';
import { PrismaService } from '../database/prisma.service.js';
import { Keyring } from '../fingerprints/crypto/keyring.js';
import { TemplateCipher } from '../fingerprints/crypto/template-cipher.service.js';
import { PrismaFingerprintsRepository } from '../fingerprints/infrastructure/prisma-fingerprints.repository.js';
import { KeyRotation } from '../keys/key-rotation.js';

/**
 * V16: operations against a real PostgreSQL. Phases (set by
 * scripts/verify-ops-db.sh): `live` seeds and rotates on the checked database;
 * `restored` reads the database restored from a backup of it.
 */
const phase = process.env.V16_PHASE;
const url = process.env.DATABASE_URL ?? '';
const OLD = Buffer.from(process.env.V16_OLD_KEY ?? '', 'base64');
const NEW = Buffer.from(process.env.V16_NEW_KEY ?? '', 'base64');
const COUNT = 25;
const safe = /gymtime_ops_check_/.test(url);

const keyring = () =>
  Keyring.fromSettings({
    ENCRYPTION_KEY: NEW.toString('base64'),
    ENCRYPTION_KEY_VERSION: 2,
    ENCRYPTION_KEYS_RETIRED: [{ version: 1, key: OLD.toString('base64') }],
  });

async function connect() {
  const prisma = new PrismaService({
    get: () => url,
  } as unknown as ConfigService<never, true>);
  await prisma.$connect();
  return { prisma, repo: new PrismaFingerprintsRepository(prisma) };
}

describe.runIf(phase === 'live' && safe)('V16 live database', () => {
  it('rotates with an interruption, verifies and repeats without changes', async () => {
    const { prisma, repo } = await connect();
    try {
      const old = new TemplateCipher(Keyring.single(OLD));
      for (let i = 0; i < COUNT; i += 1) {
        const student = await prisma.student.create({
          data: { document: `OPS-${i}`, name: `Ops ${i}` },
        });
        const sealed = old.encrypt(Buffer.from(`template-${i}`));
        await prisma.fingerprint.create({
          data: {
            studentId: student.id,
            template: new Uint8Array(sealed.data),
            iv: new Uint8Array(sealed.iv),
            keyVersion: 1,
          },
        });
      }
      const rotation = new KeyRotation(repo, keyring());
      const partial = await rotation.run({ batch: 5, limit: 10 });
      expect(partial.rotated).toBe(10);
      expect(partial.remaining).toBe(COUNT - 10);
      const rest = await rotation.run({ batch: 5 });
      expect(rest.rotated).toBe(COUNT - 10);
      expect(rest.remaining).toBe(0);
      expect((await rotation.verify()).failedIds).toEqual([]);
      const again = await rotation.run();
      expect(again.rotated).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('elects a single leader and hands over when it stops', async () => {
    const config = (retry: number) =>
      ({
        get: (key: string) =>
          key === 'DATABASE_URL'
            ? url
            : key === 'LEADER_RETRY_SECONDS'
              ? retry
              : undefined,
      }) as unknown as ConfigService<never, true>;
    const a = new PgLeaderLock(config(1));
    const b = new PgLeaderLock(config(1));
    await a.onModuleInit();
    await b.onModuleInit();
    expect([a.isLeader(), b.isLeader()].filter(Boolean)).toHaveLength(1);
    const [leader, follower] = a.isLeader() ? [a, b] : [b, a];
    await leader.onModuleDestroy();
    await follower.attempt();
    expect(follower.isLeader()).toBe(true);
    await follower.onModuleDestroy();
  });
});

describe.runIf(phase === 'restored' && safe)('V16 restored database', () => {
  it('has the same rows and every template decrypts with the keys', async () => {
    const { prisma, repo } = await connect();
    try {
      expect(await prisma.fingerprint.count()).toBe(COUNT);
      expect(await prisma.student.count()).toBe(COUNT);
      const rows = await repo.listAfter(null, 1000);
      expect(rows).toHaveLength(COUNT);
      const cipher = new TemplateCipher(keyring());
      const plain = rows
        .map((r) =>
          cipher
            .decrypt({ data: r.template, iv: r.iv, keyVersion: r.keyVersion })
            .toString(),
        )
        .sort();
      expect(plain).toEqual(
        Array.from({ length: COUNT }, (_, i) => `template-${i}`).sort(),
      );
      // A wrong key must not read anything.
      const wrong = new TemplateCipher(Keyring.single(randomBytes(32)));
      expect(() =>
        wrong.decrypt({
          data: rows[0].template,
          iv: rows[0].iv,
          keyVersion: 2,
        }),
      ).toThrow();
    } finally {
      await prisma.$disconnect();
    }
  });
});
