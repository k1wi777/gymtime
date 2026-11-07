import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { Keyring } from '../fingerprints/crypto/keyring.js';
import { PrismaFingerprintsRepository } from '../fingerprints/infrastructure/prisma-fingerprints.repository.js';
import { PrismaService } from '../database/prisma.service.js';
import { validateEnv } from '../config/env.schema.js';
import { KeyRotation } from './key-rotation.js';

/**
 * `npm run keys:rotate -w server -- [--batch N] [--limit N] [--verify]`
 *
 * Re-encrypts every template with the current key (ENCRYPTION_KEY /
 * ENCRYPTION_KEY_VERSION), keeping the retired ones readable through
 * ENCRYPTION_KEYS_RETIRED. It reads the same environment as the server and
 * runs outside the HTTP process on purpose: keys never travel over REST.
 */
const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      batch: { type: 'string' },
      limit: { type: 'string' },
      verify: { type: 'boolean' },
    },
  });
  // Variables already in the environment win over the file (Node semantics).
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
  const env = validateEnv(process.env);
  const keyring = Keyring.fromSettings(env);
  const prisma = new PrismaService({
    get: () => env.DATABASE_URL,
  } as unknown as ConfigService<never, true>);
  await prisma.$connect();
  try {
    const rotation = new KeyRotation(
      new PrismaFingerprintsRepository(prisma),
      keyring,
    );
    if (values.verify) {
      const report = await rotation.verify();
      console.log(
        `Checked ${report.checked} template(s) with the current key (version ${keyring.currentVersion}).`,
      );
      if (report.failedIds.length > 0) {
        console.error(
          `FAILED: ${report.failedIds.length} template(s) are not readable with the current key alone (ids: ${report.failedIds.slice(0, 20).join(', ')}).`,
        );
        return 1;
      }
      console.log('OK: every template decrypts with the current key alone.');
      return 0;
    }
    const report = await rotation.run({
      batch: values.batch ? Number(values.batch) : undefined,
      limit: values.limit ? Number(values.limit) : undefined,
    });
    console.log(
      `Re-encrypted ${report.rotated} template(s) to key version ${keyring.currentVersion}.`,
    );
    console.log(
      `Templates per key version: ${JSON.stringify(report.versions)}`,
    );
    console.log(
      report.remaining === 0
        ? 'Nothing left to rotate. Run again with --verify before retiring the old key.'
        : `${report.remaining} template(s) still on an older key: run the command again to continue.`,
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  // Messages never carry keys or template bytes.
  console.error(
    `Rotation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
