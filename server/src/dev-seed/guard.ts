import { UnsafeDatabaseError, databaseName } from '../reports/seed/safety.js';

export { UnsafeDatabaseError };

/** Only a database on this machine can be wiped: never a Docker/remote host. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
/** `gymtime` is the local development database; the rest are demo/test ones. */
const ALLOWED_NAME = /(demo|seed|test|dev)/i;
const DEVELOPMENT_DATABASE = 'gymtime';

export interface DevTarget {
  host: string;
  port: string;
  database: string;
}

/** `host:port/database` without credentials: what is safe to show. */
export function describeTarget(target: DevTarget): string {
  return `${target.host}:${target.port}/${target.database}`;
}

/**
 * The seed wipes and rewrites tables, so it refuses anything but the local
 * development database. Checks, in order: not production, a parseable URL
 * without host overrides in the query, a local host and an allowed name.
 * There is deliberately no override variable (unlike `seed:reports`).
 * @throws UnsafeDatabaseError (nothing has been touched at that point)
 */
export function assertDevDatabase(input: {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
}): DevTarget {
  const { nodeEnv, databaseUrl } = input;
  if (nodeEnv === 'production') {
    throw new UnsafeDatabaseError(
      'NODE_ENV=production: este comando nunca corre en producción. No se hizo ningún cambio.',
    );
  }
  if (!databaseUrl) {
    throw new UnsafeDatabaseError('DATABASE_URL no está definida');
  }
  const database = databaseName(databaseUrl);
  const parsed = new URL(databaseUrl);
  if (parsed.searchParams.has('host') || parsed.searchParams.has('hostaddr')) {
    throw new UnsafeDatabaseError(
      'DATABASE_URL redefine el host en la consulta (?host=): no se acepta. No se hizo ningún cambio.',
    );
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!LOCAL_HOSTS.has(host)) {
    throw new UnsafeDatabaseError(
      `El host "${host}" no es local (solo localhost, 127.0.0.1 o ::1). No se hizo ningún cambio.`,
    );
  }
  if (database !== DEVELOPMENT_DATABASE && !ALLOWED_NAME.test(database)) {
    throw new UnsafeDatabaseError(
      `La base "${database}" no es la de desarrollo (gymtime) ni su nombre contiene demo, seed, test o dev. No se hizo ningún cambio.`,
    );
  }
  return { host, port: parsed.port || '5432', database };
}

/**
 * The operator confirms by writing the database name (interactive) or with
 * `--confirm <name>`. Anything else is not a confirmation.
 */
export function isConfirmed(
  target: DevTarget,
  answer: string | undefined,
): boolean {
  return answer !== undefined && answer.trim() === target.database;
}
