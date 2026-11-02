import { z } from 'zod';

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

export const envSchema = z.object({
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
});

export type Env = z.infer<typeof envSchema>;

/** Validates raw environment variables; the error lists every offending variable. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? 'env');
    const missing = raw[name] === undefined || raw[name] === '';
    return `  - ${name}: ${missing ? 'is missing or empty' : issue.message}`;
  });
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}
