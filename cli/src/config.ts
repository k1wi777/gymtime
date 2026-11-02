import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigError } from './errors.js';

export interface CliConfig {
  url: string;
  apiKey: string;
}

export interface ConfigSources {
  /** Values of `--url` / `--api-key`. */
  options: { url?: string; apiKey?: string };
  env: NodeJS.ProcessEnv;
  /** Returns the file content or `undefined` when the file does not exist. */
  readFile: (path: string) => string | undefined;
}

export const DEFAULT_URL = 'http://localhost:3000';

const NAMES = {
  url: { flag: '--url', env: 'GYM_URL' },
  apiKey: { flag: '--api-key', env: 'GYM_API_KEY' },
} as const;

export function configPath(env: NodeJS.ProcessEnv): string {
  return env['GYM_CONFIG'] ?? join(homedir(), '.config', 'gymtime', 'cli.json');
}

/** Resolves the configuration: option > environment > file > default. */
export function resolveConfig(sources: ConfigSources): CliConfig {
  const { options, env } = sources;
  const file = readConfigFile(sources);
  const url =
    options.url ?? nonEmpty(env['GYM_URL']) ?? file.url ?? DEFAULT_URL;
  const apiKey =
    options.apiKey ?? nonEmpty(env['GYM_API_KEY']) ?? file.apiKey ?? '';

  if (!isHttpUrl(url)) {
    throw new ConfigError(
      `Invalid server URL: ${NAMES.url.flag} / ${NAMES.url.env} must be an http:// or https:// URL`,
    );
  }
  if (apiKey === '') {
    throw new ConfigError(
      `Missing admin API key: set ${NAMES.apiKey.flag}, ${NAMES.apiKey.env} or "apiKey" in ${configPath(env)}`,
    );
  }
  return { url: url.replace(/\/+$/, ''), apiKey };
}

function readConfigFile(sources: ConfigSources): {
  url?: string;
  apiKey?: string;
} {
  const path = configPath(sources.env);
  let raw: string | undefined;
  try {
    raw = sources.readFile(path);
  } catch {
    throw new ConfigError(`Cannot read the configuration file ${path}`);
  }
  if (raw === undefined) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // The parse error could quote file content, so it is not forwarded.
    throw new ConfigError(`The configuration file ${path} is not valid JSON`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ConfigError(`The configuration file ${path} must be an object`);
  }
  const { url, apiKey } = data as Record<string, unknown>;
  return {
    url: typeof url === 'string' ? nonEmpty(url) : undefined,
    apiKey: typeof apiKey === 'string' ? nonEmpty(apiKey) : undefined,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
