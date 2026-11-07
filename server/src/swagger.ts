import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { buildOpenApiDocument } from './openapi/build-document.js';

/**
 * Swagger UI needs inline scripts that the API's CSP forbids, so in
 * production /docs and /docs-json are off unless ENABLE_DOCS=true.
 */
export function docsEnabled(env: {
  NODE_ENV: string;
  ENABLE_DOCS: boolean;
}): boolean {
  return env.NODE_ENV !== 'production' || env.ENABLE_DOCS;
}

/** Publishes Swagger UI at /docs and the OpenAPI JSON at /docs-json. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs-json',
  });
}
