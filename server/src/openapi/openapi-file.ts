import { fileURLToPath } from 'node:url';

/** Where the versioned contract lives; the panel generates its types from it. */
export const OPENAPI_FILE = fileURLToPath(
  new URL('../../openapi.json', import.meta.url),
);
