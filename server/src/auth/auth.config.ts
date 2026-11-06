import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';

export interface AuthConfig {
  adminApiKey: string;
  cookie: {
    domain: string | undefined;
    sameSite: Env['COOKIE_SAMESITE'];
    secure: boolean;
  };
  corsOrigins: string[];
  sessionIdleMs: number;
  sessionMaxMs: number;
  maxFailedAttempts: number;
  lockMs: number;
  /** Sign-in attempts per IP and minute. */
  loginRateLimit: number;
  firstAdmin: { username: string; password: string } | null;
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export function authConfigFromEnv(env: ConfigService<Env, true>): AuthConfig {
  const username = env.get('FIRST_ADMIN_USERNAME', { infer: true });
  const password = env.get('FIRST_ADMIN_PASSWORD', { infer: true });
  return {
    adminApiKey: env.get('ADMIN_API_KEY', { infer: true }),
    cookie: {
      domain: env.get('COOKIE_DOMAIN', { infer: true }),
      sameSite: env.get('COOKIE_SAMESITE', { infer: true }),
      secure: env.get('NODE_ENV', { infer: true }) === 'production',
    },
    corsOrigins: env.get('CORS_ORIGINS', { infer: true }),
    sessionIdleMs: env.get('SESSION_IDLE_MINUTES', { infer: true }) * MINUTE_MS,
    sessionMaxMs: env.get('SESSION_MAX_HOURS', { infer: true }) * HOUR_MS,
    maxFailedAttempts: env.get('LOGIN_MAX_ATTEMPTS', { infer: true }),
    lockMs: env.get('LOGIN_LOCK_MINUTES', { infer: true }) * MINUTE_MS,
    loginRateLimit: env.get('LOGIN_RATE_LIMIT', { infer: true }),
    firstAdmin: username && password ? { username, password } : null,
  };
}

/** The documented defaults; tests override what they need. */
export const defaultAuthConfig: AuthConfig = {
  adminApiKey: 'admin-key-1234567890',
  cookie: { domain: undefined, sameSite: 'Strict', secure: false },
  corsOrigins: [],
  sessionIdleMs: 30 * MINUTE_MS,
  sessionMaxMs: 8 * HOUR_MS,
  maxFailedAttempts: 5,
  lockMs: 15 * MINUTE_MS,
  loginRateLimit: 10,
  firstAdmin: null,
};
