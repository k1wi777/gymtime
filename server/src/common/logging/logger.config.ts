import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.schema.js';

/**
 * Secrets and biometric data that must never reach the logs.
 * Field convention for domain logs: `deviceId`, `messageId`, `event`.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-admin-key"]',
  'req.headers["x-api-key"]',
  'req.headers["x-device-token"]',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.temporaryPassword',
  '*.passwordHash',
  'password',
  'passwordHash',
  '*.token',
  '*.plantilla',
  '*.template',
  'token',
  'plantilla',
  'template',
];

export const REDACT_CENSOR = '[REDACTED]';

export function buildLoggerParams(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
): Params {
  const pretty = env.NODE_ENV === 'development';
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
      // Request/response only: method, url, status and responseTime, no payloads.
      serializers: {
        req: (req: { method: string; url: string; id: unknown }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      transport: pretty
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss.l',
            },
          }
        : undefined,
    },
  };
}
