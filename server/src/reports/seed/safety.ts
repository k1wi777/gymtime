/** Databases a simulated semester may be written to (by name). */
export const SAFE_DATABASE_NAME = /(demo|seed|test)/i;

export class UnsafeDatabaseError extends Error {}

/** Name of the database in a PostgreSQL URL (without the query string). */
export function databaseName(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeDatabaseError('DATABASE_URL no es una URL válida');
  }
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
}

/**
 * The seed refuses to run against a database that is not explicitly for
 * demos or tests: its name must contain `demo`, `seed` or `test`, or the
 * operator must name it exactly in `SEED_ALLOW`.
 * @throws UnsafeDatabaseError
 */
export function assertSafeDatabase(
  url: string | undefined,
  allow: string | undefined,
): string {
  if (!url) throw new UnsafeDatabaseError('DATABASE_URL no está definida');
  const name = databaseName(url);
  if (name === '')
    throw new UnsafeDatabaseError('DATABASE_URL no indica una base');
  if (
    SAFE_DATABASE_NAME.test(name) ||
    (allow !== undefined && allow === name)
  ) {
    return name;
  }
  throw new UnsafeDatabaseError(
    `La base "${name}" no parece de demostración o prueba (su nombre debe contener demo, seed o test). ` +
      `Si de verdad quiere sembrarla, defina SEED_ALLOW=${name}. No se hizo ningún cambio.`,
  );
}
