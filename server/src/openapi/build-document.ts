import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  getSchemaPath,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { SESSION_COOKIE } from '../auth/cookie.js';
import { ApiErrorDto } from './api-error.dto.js';

export const ADMIN_KEY_HEADER = 'x-api-key';

/** Error statuses documented with the common body of `ApiErrorDto`. */
const ERROR_STATUS = /^4\d\d$/;

type Operation = {
  responses?: Record<
    string,
    { description?: string; content?: Record<string, unknown> }
  >;
};

/**
 * Builds the OpenAPI document of the application. Shared by Swagger UI
 * (`/docs-json`) and the `openapi:export` script, so both publish the same thing.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('GymTime API')
    .setDescription('Attendance and alarm backend for GymTime')
    .setVersion('0.0.1')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: ADMIN_KEY_HEADER },
      'admin-key',
    )
    .addCookieAuth(
      SESSION_COOKIE,
      { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
      'session',
    )
    .addTag('health')
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ApiErrorDto],
  });
  attachErrorBody(document);
  return document;
}

/**
 * Gives every 4xx answer that has no body schema the common error format, in
 * one place instead of on every decorator.
 */
export function attachErrorBody(document: OpenAPIObject): void {
  const schema = { $ref: getSchemaPath(ApiErrorDto) };
  for (const path of Object.values(document.paths)) {
    for (const value of Object.values(path)) {
      const responses = (value as Operation | undefined)?.responses;
      if (!responses) continue;
      for (const [status, response] of Object.entries(responses)) {
        if (!ERROR_STATUS.test(status) || response.content) continue;
        response.content = { 'application/json': { schema } };
      }
    }
  }
}

/** Same document, keys sorted at every level, so the exported file is stable. */
export function serializeOpenApi(document: OpenAPIObject): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, sorted(item)]),
      );
    }
    return value;
  };
  return `${JSON.stringify(sorted(document), null, 2)}\n`;
}
