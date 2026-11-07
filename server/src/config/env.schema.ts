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

/**
 * Retired encryption keys: `"1:<base64>,2:<base64>"` (version:key). Each key
 * must be a valid AES-256 key and each version appear once.
 */
const retiredKeys = z.preprocess(
  emptyAsUnset,
  z
    .string()
    .optional()
    .transform((raw, context) => {
      const keys: Array<{ version: number; key: string }> = [];
      for (const item of (raw ?? '').split(',')) {
        const entry = item.trim();
        if (entry === '') continue;
        const [versionText, key, ...rest] = entry.split(':');
        const version = Number(versionText);
        const ok =
          rest.length === 0 &&
          /^[1-9]\d{0,5}$/.test(versionText ?? '') &&
          key !== undefined &&
          BASE64.test(key) &&
          Buffer.from(key, 'base64').length === ENCRYPTION_KEY_BYTES;
        if (!ok) {
          // Never echo the entry: it contains key material.
          context.addIssue({
            code: 'custom',
            message:
              'each entry must be <version>:<base64 of 32 bytes>, separated by commas',
          });
          return z.NEVER;
        }
        if (keys.some((k) => k.version === version)) {
          context.addIssue({
            code: 'custom',
            message: `version ${version} appears more than once`,
          });
          return z.NEVER;
        }
        keys.push({ version, key });
      }
      return keys;
    }),
);

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
    // Shared token of the first iteration: optional since H11 (a device with its
    // own token, or a revoked one, no longer accepts it). Unset = own tokens only.
    DEVICE_TOKEN: z.preprocess(emptyAsUnset, secret.optional()),
    ADMIN_API_KEY: secret,
    ENCRYPTION_KEY: encryptionKey,
    // Key ring (H11): ENCRYPTION_KEY is the CURRENT key and this its version;
    // older versions stay readable through ENCRYPTION_KEYS_RETIRED until
    // `npm run keys:rotate` has re-encrypted every template.
    ENCRYPTION_KEY_VERSION: z.preprocess(
      emptyAsUnset,
      z.coerce.number().int().min(1).max(999_999).default(1),
    ),
    ENCRYPTION_KEYS_RETIRED: retiredKeys,
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
    // JSON file `{version, text}` with the official consent text (E25-9);
    // unset = the provisional text. Validated at startup.
    CONSENT_FILE: optionalText,
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
    // Minutes a device that had connected may stay offline before an alert is
    // raised (log, audit trail, event stream and panel). 0 disables the alert.
    DEVICE_OFFLINE_ALERT_MINUTES: authInt(0, 1440, 5),
    // Offline mode (H12). Seconds an event time may be ahead of the server
    // clock, and hours it may be behind it, before it goes to review.
    OFFLINE_TS_FUTURE_TOLERANCE_SEC: authInt(0, 3600, 120),
    OFFLINE_TS_MAX_AGE_HOURS: authInt(1, 720, 72),
    // Seconds the snapshot waits for a reader's queued events to arrive.
    OFFLINE_SNAPSHOT_WAIT_SEC: authInt(0, 600, 60),
    // Days a snapshot is kept to resolve late events.
    OFFLINE_SNAPSHOT_RETENTION_DAYS: authInt(1, 365, 14),
    // |device clock - server clock| in seconds that raises the clock warning.
    CLOCK_OFFSET_WARN_SEC: authInt(1, 3600, 30),
    // Seconds between attempts to take the scheduler lock (H11).
    LEADER_RETRY_SECONDS: authInt(1, 300, 10),
    // Publish /docs (Swagger UI) in production too. Off by default there.
    ENABLE_DOCS: z.preprocess(
      emptyAsUnset,
      z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    ),
    // First administrator, created only when there are no accounts yet.
    FIRST_ADMIN_USERNAME: optionalText,
    FIRST_ADMIN_PASSWORD: z.preprocess(emptyAsUnset, z.string().optional()),
  })
  .superRefine((env, context) => {
    if (
      env.ENCRYPTION_KEYS_RETIRED.some(
        (k) => k.version === env.ENCRYPTION_KEY_VERSION,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ENCRYPTION_KEYS_RETIRED'],
        message: 'must not contain the current ENCRYPTION_KEY_VERSION',
      });
    }
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
