/**
 * Example values the repository itself distributes (`.env.example`, compose
 * files, tests, sample data). In production they are known to everybody, so
 * the server refuses to start with them. Pure functions: they never see more
 * than the value they are given and never return it.
 */

/** Lower-case prefixes of example secrets (API key, device token, password). */
const PLACEHOLDER_PREFIXES = [
  'change-me',
  'changeme',
  'replace-me',
  'replace_me',
  'your-',
  'example',
  'placeholder',
  'secret',
  'password',
  'admin-key',
  'device-token',
  'dev-',
  'test-',
  'demo-',
] as const;

/** Passwords of the development database that the repository ships. */
const PLACEHOLDER_DB_PASSWORDS = new Set([
  'gymtime_dev_password',
  'ci_password',
  'postgres',
  'password',
]);

/** True for `change-me*`-like values or a single character repeated. */
export function isPlaceholderSecret(value: string): boolean {
  const lower = value.trim().toLowerCase();
  if (lower === '') return false;
  if (PLACEHOLDER_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return true;
  }
  return new Set(lower).size === 1;
}

/** True when the key bytes are one byte repeated or a pattern of up to 4 bytes. */
export function isPlaceholderKey(key: Buffer): boolean {
  if (key.length === 0) return false;
  for (let size = 1; size <= 4; size++) {
    if (key.length % size !== 0) continue;
    const pattern = key.subarray(0, size);
    let repeats = true;
    for (let i = size; i < key.length && repeats; i += size) {
      repeats = key.subarray(i, i + size).equals(pattern);
    }
    if (repeats) return true;
  }
  return false;
}

/** True when the URL carries an empty or well-known development password. */
export function hasPlaceholderDbPassword(databaseUrl: string): boolean {
  try {
    const password = decodeURIComponent(new URL(databaseUrl).password);
    return password === '' || PLACEHOLDER_DB_PASSWORDS.has(password);
  } catch {
    // Not parseable: the URL check of the schema reports it.
    return false;
  }
}

export const HOW_TO_GENERATE = 'openssl rand -base64 32';
