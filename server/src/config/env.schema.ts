import { z } from 'zod';
import { checkPassword } from '../auth/password-policy.js';
import { USERNAME_PATTERN, normalizeUsername } from '../auth/username.js';

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ENCRYPTION_KEY_BYTES = 32;

// Minimum length rejects trivial placeholder secrets.
const secret = z.string().min(16, 'must be at least 16 characters');

const encryptionKey = z
  .string()
  .min(1, 'is required')
  .refine(
    (value) =>
      BASE64.test(value) &&
      Buffer.from(value, 'base64').length === ENCRYPTION_KEY_BYTES,
    `must be base64 and decode to exactly ${ENCRYPTION_KEY_BYTES} bytes (AES-256-GCM)`,
  );

/** `.env` files keep empty assignments (`COOKIE_DOMAIN=`): they mean "unset". */
const emptyAsUnset = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = z.preprocess(emptyAsUnset, z.string().trim().optional());

/** An exact origin (`scheme://host[:port]`): no wildcard, path, query or userinfo. */
function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const plain = url.protocol === 'http:' || url.protocol === 'https:';
    return plain && url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

const corsOrigins = z.preprocess(
  emptyAsUnset,
  z
    .string()
    .optional()
    .transform((raw, context) => {
      const origins: string[] = [];
      for (const item of (raw ?? '').split(',')) {
        const value = item.trim();
        if (value === '') continue;
        const origin = parseOrigin(value);
        if (!origin) {
          context.addIssue({
            code: 'custom',
            message: `"${value}" is not an exact origin (scheme://host[:port], no wildcard or path)`,
          });
          return z.NEVER;
        }
        origins.push(origin);
      }
      return origins;
    }),
);

const authInt = (min: number, max: number, fallback: number) =>
  z.preprocess(
    emptyAsUnset,
    z.coerce.number().int().min(min).max(max).default(fallback),
  );

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    DATABASE_URL: z
      .string()
      .min(1, 'is required')
      .refine(
        (value) => /^postgres(ql)?:\/\//.test(value),
        'must be a PostgreSQL connection URL',
      ),
    DEVICE_TOKEN: secret,
    ADMIN_API_KEY: secret,
    ENCRYPTION_KEY: encryptionKey,
    // Default entry window of a schedule: opens N min before it starts and
    // closes M min before it ends (a schedule may override both).
    ENTRY_OPEN_MINUTES: z.coerce.number().int().min(0).max(240).default(10),
    ENTRY_CLOSE_MINUTES: z.coerce.number().int().min(0).max(240).default(5),
    // How long before a schedule starts its templates are loaded into the reader.
    SYNC_LEAD_MINUTES: z.coerce.number().int().min(0).max(240).default(15),
    // Short beep when a schedule ends with nobody inside.
    ALARM_BEEP_SECONDS: z.coerce.number().int().min(1).max(300).default(5),
    // After a schedule ends, how long until abandoned sessions are closed.
    ALARM_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    // Reader LCD: size and default time a message stays on screen.
    DISPLAY_COLS: z.coerce.number().int().min(8).max(40).default(16),
    DISPLAY_ROWS: z.coerce.number().int().min(1).max(4).default(2),
    DISPLAY_RESULT_SECONDS: z.coerce.number().int().min(1).max(60).default(3),
    // Panel accounts: session cookie, CORS and sign-in protection.
    COOKIE_DOMAIN: optionalText,
    COOKIE_SAMESITE: z.preprocess(
      emptyAsUnset,
      z.enum(['Strict', 'Lax', 'None']).default('Strict'),
    ),
    CORS_ORIGINS: corsOrigins,
    SESSION_IDLE_MINUTES: authInt(1, 1440, 30),
    SESSION_MAX_HOURS: authInt(1, 720, 8),
    LOGIN_MAX_ATTEMPTS: authInt(1, 100, 5),
    LOGIN_LOCK_MINUTES: authInt(1, 1440, 15),
    // Sign-in attempts allowed per IP and minute.
    LOGIN_RATE_LIMIT: authInt(1, 1000, 10),
    // Reverse-proxy hops to trust when reading the client IP.
    TRUST_PROXY: authInt(0, 10, 0),
    // First administrator, created only when there are no accounts yet.
    FIRST_ADMIN_USERNAME: optionalText,
    FIRST_ADMIN_PASSWORD: z.preprocess(emptyAsUnset, z.string().optional()),
  })
  .superRefine((env, context) => {
    if (env.COOKIE_SAMESITE === 'None' && env.NODE_ENV !== 'production') {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SAMESITE'],
        message:
          'None requires NODE_ENV=production (the cookie must be Secure)',
      });
    }
    const { FIRST_ADMIN_USERNAME: username, FIRST_ADMIN_PASSWORD: password } =
      env;
    if ((username === undefined) !== (password === undefined)) {
      context.addIssue({
        code: 'custom',
        path: [
          username === undefined
            ? 'FIRST_ADMIN_USERNAME'
            : 'FIRST_ADMIN_PASSWORD',
        ],
        message: 'FIRST_ADMIN_USERNAME and FIRST_ADMIN_PASSWORD go together',
      });
      return;
    }
    if (username === undefined || password === undefined) return;
    if (!USERNAME_PATTERN.test(normalizeUsername(username))) {
      context.addIssue({
        code: 'custom',
        path: ['FIRST_ADMIN_USERNAME'],
        message: '3-50 characters: letters, digits, dot, dash or underscore',
      });
    }
    const problem = checkPassword(password, username);
    if (problem) {
      context.addIssue({
        code: 'custom',
        path: ['FIRST_ADMIN_PASSWORD'],
        message: `does not meet the password policy (${problem})`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Validates raw environment variables; the error lists every offending variable. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? 'env');
    const missing =
      issue.code !== 'custom' && (raw[name] === undefined || raw[name] === '');
    return `  - ${name}: ${missing ? 'is missing or empty' : issue.message}`;
  });
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}
