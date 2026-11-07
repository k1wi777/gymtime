import type { INestApplication } from '@nestjs/common';
import { json, type NextFunction, type Request, type Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import type { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import type { Env } from './config/env.schema.js';
import { securityHeaders } from './security-headers.js';

export interface HttpOptions {
  /** Exact origins allowed to call the API from a browser. */
  corsOrigins: readonly string[];
  /** Reverse-proxy hops to trust when reading `req.ip` (0 = none). */
  trustProxy: number;
  /** Production adds HSTS on HTTPS requests. */
  production?: boolean;
}

export const CORS_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];
// `x-api-key` is deliberately absent: the key is for the CLI, not for browsers.
export const CORS_ALLOWED_HEADERS = ['content-type', 'x-gymtime-client'];
export const CORS_EXPOSED_HEADERS = ['retry-after'];
/** Seconds a browser may cache a preflight answer. */
export const CORS_MAX_AGE = 600;

/**
 * Body limit of the CSV import: the file travels as text inside the JSON, and
 * the default 100 kb would not fit a class list. Only those routes get it.
 */
export const IMPORT_BODY_LIMIT = '2mb';
export const IMPORT_PATH = '/students/import';

export function httpOptionsFromEnv(env: ConfigService<Env, true>): HttpOptions {
  return {
    corsOrigins: env.get('CORS_ORIGINS', { infer: true }),
    trustProxy: env.get('TRUST_PROXY', { infer: true }),
    production: env.get('NODE_ENV', { infer: true }) === 'production',
  };
}

/**
 * HTTP settings shared by `main.ts` and the e2e wiring: CORS only for the
 * listed origins (with credentials, since the session is a cookie) and the
 * proxy hops that decide `req.ip`. An origin that is not listed receives no
 * CORS header at all, not even on the preflight.
 */
export function configureHttp(
  app: INestApplication,
  options: HttpOptions,
): void {
  const express = app.getHttpAdapter().getInstance() as {
    set: (name: string, value: unknown) => void;
  };
  express.set('x-powered-by', false);
  if (options.trustProxy > 0) express.set('trust proxy', options.trustProxy);
  // Before CORS so that even preflight answers carry the headers.
  app.use(securityHeaders({ production: options.production === true }));

  // Registered before Nest adds its own parser: the first one to read the
  // body wins, and the rest skip an already parsed request.
  // Wrapped on purpose: Nest skips its own parser when it finds a layer named
  // `jsonParser`, which would leave every other route without a body.
  const importParser = json({ limit: IMPORT_BODY_LIMIT });
  app.use(IMPORT_PATH, (req: Request, res: Response, next: NextFunction) =>
    importParser(req, res, next),
  );

  const allowed = new Set(options.corsOrigins);
  const delegate: CorsOptionsDelegate<{ headers: Record<string, unknown> }> = (
    request,
    callback,
  ) => {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowed.has(origin)) {
      callback(null, { origin: false });
      return;
    }
    callback(null, {
      origin,
      credentials: true,
      methods: CORS_METHODS,
      allowedHeaders: CORS_ALLOWED_HEADERS,
      exposedHeaders: CORS_EXPOSED_HEADERS,
      maxAge: CORS_MAX_AGE,
    });
  };
  app.enableCors(delegate as never);
}
