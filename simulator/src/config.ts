import { parseArgs } from 'node:util';
import { z } from 'zod';

export interface SimulatorConfig {
  url: string;
  deviceId: string;
  token: string;
  fw: string;
}

const wsUrl = z.string().refine((value) => {
  try {
    return ['ws:', 'wss:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, 'must be a ws:// or wss:// URL');

const configSchema = z.object({
  url: wsUrl,
  deviceId: z.string().min(1, 'must not be empty'),
  token: z.string().min(1, 'is required'),
  fw: z.string().min(1, 'must not be empty'),
});

const OPTIONS = {
  url: { flag: '--url', env: 'SIM_URL' },
  deviceId: { flag: '--device-id', env: 'SIM_DEVICE_ID' },
  token: { flag: '--token', env: 'SIM_DEVICE_TOKEN' },
  fw: { flag: '--fw', env: 'SIM_FW' },
} as const;

export const DEFAULT_URL = 'ws://localhost:3000/device';
export const DEFAULT_DEVICE_ID = 'esp32-sim-01';
export const DEFAULT_FW = 'sim-1.0.0';

export class ConfigError extends Error {}

/** Resolves the configuration: argument > environment > default. */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  argv: string[],
): SimulatorConfig {
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        url: { type: 'string' },
        'device-id': { type: 'string' },
        token: { type: 'string' },
        fw: { type: 'string' },
      },
      strict: true,
    }));
  } catch (error) {
    // The message of parseArgs names the offending flag, never a value.
    throw new ConfigError((error as Error).message);
  }

  const candidate = {
    url: values['url'] ?? env[OPTIONS.url.env] ?? DEFAULT_URL,
    deviceId:
      values['device-id'] ?? env[OPTIONS.deviceId.env] ?? DEFAULT_DEVICE_ID,
    token: values['token'] ?? env[OPTIONS.token.env] ?? '',
    fw: values['fw'] ?? env[OPTIONS.fw.env] ?? DEFAULT_FW,
  };

  const result = configSchema.safeParse(candidate);
  if (result.success) return result.data;

  // Only option names and rule messages are reported, never the values.
  const problems = result.error.issues.map((issue) => {
    const key = String(issue.path[0]) as keyof typeof OPTIONS;
    const { flag, env: envName } = OPTIONS[key];
    return `${flag} / ${envName} ${issue.message}`;
  });
  throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);
}
