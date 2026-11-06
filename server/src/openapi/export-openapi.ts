import { writeFileSync } from 'node:fs';
import { OPENAPI_FILE } from './openapi-file.js';
import { randomBytes } from 'node:crypto';

/** Throwaway values: the document does not depend on them, only the config validation does. */
function useDummyEnvironment(): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://openapi:openapi@localhost:5432/openapi',
    DEVICE_TOKEN: 'openapi-export-device-token',
    ADMIN_API_KEY: 'openapi-export-admin-key',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
}

/**
 * Writes `server/openapi.json` without a database: Nest's preview mode
 * resolves the routes and metadata but does not create providers.
 * Run it through `npm --prefix server run openapi:export`.
 */
async function exportOpenApi(): Promise<void> {
  useDummyEnvironment();
  const [
    { NestFactory },
    { AppModule },
    { buildOpenApiDocument, serializeOpenApi },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module.js'),
    import('./build-document.js'),
  ]);
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });
  writeFileSync(OPENAPI_FILE, serializeOpenApi(buildOpenApiDocument(app)));
  await app.close();
  process.stdout.write(`openapi.json written to ${OPENAPI_FILE}\n`);
}

await exportOpenApi();
