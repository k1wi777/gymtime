import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { keyFigures } from './expected.js';
import {
  isLoaded,
  loadSemesterInPrisma,
  resetSimulation,
} from './load-prisma.js';
import { UnsafeDatabaseError, assertSafeDatabase } from './safety.js';
import { SEMESTER_NOW, buildSemester } from './semester.js';

/** Entry of `npm run seed:reports -- [--reset] [--scale N]`. */
function parseArgs(argv: string[]): { reset: boolean; scale: number } {
  let reset = false;
  let scale = 1;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reset') reset = true;
    else if (arg === '--scale') scale = Number(argv[++i]);
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (!Number.isInteger(scale) || scale < 1 || scale > 50) {
    throw new Error('--scale debe ser un entero entre 1 y 50');
  }
  return { reset, scale };
}

async function main(): Promise<void> {
  // Same single .env at the repository root as Prisma's own config.
  const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (!process.env.DATABASE_URL && existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }
  const { reset, scale } = parseArgs(process.argv.slice(2));
  const name = assertSafeDatabase(
    process.env.DATABASE_URL,
    process.env.SEED_ALLOW,
  );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const data = buildSemester({ scale });
    if (reset) {
      const removed = await resetSimulation(prisma);
      console.log(`Reinicio en "${name}": se borró solo lo simulado`, removed);
    }
    const result = await loadSemesterInPrisma(prisma, data);
    if (!result.loaded) {
      console.log(
        `El semestre simulado ya está en "${name}"; no se cambió nada (use --reset para recrearlo).`,
      );
    } else {
      console.log(`Semestre simulado cargado en "${name}":`, result.counts);
      if (!result.periodActive) {
        console.log(
          'Hay otro periodo activo: el simulado quedó inactivo; elija el rango de fechas a mano en Reportes.',
        );
      }
    }
    if (!(await isLoaded(prisma, data)))
      throw new Error('La carga no quedó completa');
    console.log(
      '\nCifras esperadas (ahora simulado = 2026-05-30 12:00, Bogotá):',
    );
    console.log(JSON.stringify(keyFigures(data, SEMESTER_NOW), null, 2));
    console.log(
      '\nCompárelas con GET /reports/*?from=2026-02-02&to=2026-05-29 o con el panel (Reportes).' +
        '\nNota: con la hora real del servidor las ocurrencias futuras no cuentan; las cifras de "asistencia" ' +
        'coinciden si el reloj es posterior al 2026-05-29.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = error instanceof UnsafeDatabaseError ? 2 : 1;
});
