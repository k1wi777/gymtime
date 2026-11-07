import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { Argon2idPasswordHasher } from '../auth/password-hasher.js';
import { toBogotaParts } from '../common/time/bogota.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { Keyring } from '../fingerprints/crypto/keyring.js';
import { TemplateCipher } from '../fingerprints/crypto/template-cipher.service.js';
import { defaultFingerprintsConfig } from '../fingerprints/fingerprints.config.js';
import { isLoaded, loadSemesterInPrisma } from '../reports/seed/load-prisma.js';
import { buildSemester } from '../reports/seed/semester.js';
import { DEMO_USERS, buildDemoDataset } from './dataset.js';
import {
  UnsafeDatabaseError,
  assertDevDatabase,
  describeTarget,
  isConfirmed,
} from './guard.js';
import { prepareSecrets, replaceWithDataset } from './load-prisma.js';
import { WIPE_TABLES } from './wipe.js';

const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));
const KEPT_TABLE = '_prisma_migrations';

interface Args {
  confirm: string | undefined;
  today: string | undefined;
  withSemester: boolean;
  dryRun: boolean;
}

/** `npm run seed:dev -- [--confirm <db>] [--today YYYY-MM-DD] [--with-semester] [--dry-run]` */
export function parseArgs(argv: string[]): Args {
  const args: Args = {
    confirm: undefined,
    today: undefined,
    withSemester: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--confirm') args.confirm = argv[++i];
    else if (arg === '--today') args.today = argv[++i];
    else if (arg === '--with-semester') args.withSemester = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (args.today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.today)) {
    throw new Error('--today debe ser YYYY-MM-DD');
  }
  if (args.confirm !== undefined && args.dryRun) {
    throw new Error('--dry-run y --confirm no se combinan');
  }
  return args;
}

/** The same key the server uses; only validated here, never shown. */
function keyringFromEnv(env: NodeJS.ProcessEnv): Keyring {
  const raw = env.ENCRYPTION_KEY ?? '';
  const key = Buffer.from(raw, 'base64');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || key.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY falta o no es una clave AES-256 válida (base64 de 32 bytes). No se hizo ningún cambio.',
    );
  }
  const version = Number(env.ENCRYPTION_KEY_VERSION ?? 1);
  return new Keyring(
    Number.isInteger(version) && version > 0 ? version : 1,
    key,
  );
}

type Prisma = InstanceType<typeof PrismaClient>;

/** Rows per table; `null` when the table does not exist yet (pending migration). */
async function countRows(
  prisma: Prisma,
): Promise<Record<string, number | null>> {
  const counts: Record<string, number | null> = {};
  for (const table of WIPE_TABLES) {
    // Table names come from the fixed list above, never from input.
    const [{ exists }] = await prisma.$queryRawUnsafe<[{ exists: boolean }]>(
      `SELECT to_regclass('public."${table}"') IS NOT NULL AS exists`,
    );
    counts[table] = exists
      ? Number(
          (
            await prisma.$queryRawUnsafe<[{ n: bigint }]>(
              `SELECT count(*) AS n FROM "${table}"`,
            )
          )[0].n,
        )
      : null;
  }
  return counts;
}

async function pendingMigrations(prisma: Prisma): Promise<string[]> {
  const known = readdirSync(`${SERVER_DIR}prisma/migrations`, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const [{ exists }] = await prisma.$queryRawUnsafe<[{ exists: boolean }]>(
    `SELECT to_regclass('public."${KEPT_TABLE}"') IS NOT NULL AS exists`,
  );
  if (!exists) return known;
  const applied = new Set(
    (
      await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
        `SELECT migration_name FROM "${KEPT_TABLE}" WHERE finished_at IS NOT NULL`,
      )
    ).map((row) => row.migration_name),
  );
  return known.filter((name) => !applied.has(name));
}

/** A short, human list of what is about to be deleted (documents and ids only). */
async function sampleRows(
  prisma: Prisma,
  counts: Record<string, number | null>,
) {
  const lines: string[] = [];
  if ((counts.students ?? 0) > 0) {
    const rows = await prisma.student.findMany({
      select: { document: true, active: true },
      orderBy: { document: 'asc' },
      take: 20,
    });
    lines.push(
      `  students: ${rows.map((r) => `${r.document}${r.active ? '' : ' (inactivo)'}`).join(', ')}`,
    );
  }
  if ((counts.devices ?? 0) > 0) {
    const rows = await prisma.device.findMany({
      // Only columns that exist in every schema version: the database may
      // still be waiting for migrations when this report is made.
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 20,
    });
    lines.push(`  devices: ${rows.map((r) => r.id).join(', ')}`);
  }
  if ((counts.panel_users ?? 0) > 0) {
    const rows = await prisma.panelUser.findMany({
      select: { username: true },
      orderBy: { username: 'asc' },
      take: 20,
    });
    lines.push(`  panel_users: ${rows.map((r) => r.username).join(', ')}`);
  }
  return lines;
}

async function askConfirmation(database: string): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(
      `Para continuar escriba el nombre de la base (${database}): `,
    );
  } finally {
    rl.close();
  }
}

function applyMigrations(): void {
  console.log('\nAplicando migraciones pendientes (prisma migrate deploy)...');
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      'Falló prisma migrate deploy. No se borró ni se cargó nada.',
    );
  }
}

async function main(): Promise<void> {
  // Same single .env at the repository root as Prisma; values already in the
  // environment win, and nothing is ever written back or printed.
  const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const args = parseArgs(process.argv.slice(2));
  const target = assertDevDatabase({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
  });
  const keyring = keyringFromEnv(process.env);
  const today = args.today ?? toBogotaParts(new Date()).date;
  const dataset = buildDemoDataset({ today });

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const counts = await countRows(prisma);
    const pending = await pendingMigrations(prisma);

    console.log(`Base: ${describeTarget(target)}   (hoy en Bogotá: ${today})`);
    console.log('\nSe BORRARÁ (filas actuales por tabla):');
    for (const table of WIPE_TABLES) {
      const n = counts[table];
      console.log(
        `  ${table.padEnd(22)} ${n === null ? 'no existe aún (migración pendiente)' : n}`,
      );
    }
    for (const line of await sampleRows(prisma, counts)) console.log(line);
    console.log(
      `\nSe CONSERVA: el esquema, la tabla ${KEPT_TABLE}, .env y las claves, y cualquier otra base.`,
    );
    console.log(
      pending.length > 0
        ? `\nMigraciones pendientes que se aplicarán (aditivas): ${pending.length}\n${pending.map((m) => `  ${m}`).join('\n')}`
        : '\nNo hay migraciones pendientes.',
    );
    console.log('\nSe CREARÁ (marcado DEMO-####):');
    console.log(
      `  ${dataset.students.length} estudiantes (${dataset.fingerprints.length} con huella de muestra), ` +
        `${dataset.schedules.length} horarios, ${dataset.instances.length} ocurrencias, ` +
        `${dataset.sessions.length} asistencias, ${dataset.alarms.length} alarmas,`,
    );
    console.log(
      `  1 periodo con ${dataset.exceptions.length} intervalos sin servicio, 1 lote de importación, ` +
        `dispositivo ${dataset.device.id} (sin token propio), ${dataset.offlineEvents.length} eventos sin conexión, ` +
        `${dataset.eventLog.length} entradas de auditoría y los usuarios ${DEMO_USERS.map((u) => u.username).join(' y ')}.`,
    );
    if (args.withSemester)
      console.log('  Además el semestre simulado SIM- (--with-semester).');

    if (args.dryRun) {
      console.log('\nSimulación (--dry-run): no se cambió nada.');
      return;
    }
    const answer = args.confirm ?? (await askConfirmation(target.database));
    if (!isConfirmed(target, answer)) {
      console.log(
        `\nSin confirmación no se cambió nada. Escriba el nombre de la base en la terminal o use --confirm ${target.database}.`,
      );
      process.exitCode = 2;
      return;
    }

    if (pending.length > 0) applyMigrations();
    const prepared = await prepareSecrets(dataset, {
      hasher: new Argon2idPasswordHasher(),
      cipher: new TemplateCipher(keyring),
      templateBytes: defaultFingerprintsConfig.expectedTemplateBytes,
    });
    const outcome = await replaceWithDataset(prisma, dataset, prepared);
    console.log('\nBorrado:', outcome.removed);
    console.log('Creado:', outcome.created);

    if (args.withSemester) {
      const semester = buildSemester({ scale: 1 });
      const result = await loadSemesterInPrisma(prisma, semester);
      console.log(
        result.loaded
          ? `Semestre simulado cargado${result.periodActive ? '' : ' (queda inactivo: ya hay un periodo activo)'}.`
          : 'El semestre simulado ya estaba cargado.',
      );
      if (!(await isLoaded(prisma, semester)))
        throw new Error('La carga del semestre no quedó completa');
    }
    console.log(
      '\nUsuarios del panel (solo desarrollo; contraseñas en docs/datos_de_muestra.md):',
    );
    for (const user of DEMO_USERS)
      console.log(`  ${user.username} (${user.role})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = error instanceof UnsafeDatabaseError ? 2 : 1;
});
