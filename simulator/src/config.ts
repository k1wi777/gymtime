import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  DEFAULT_ENROLLMENT,
  ENROLL_MODES,
  type EnrollmentOptions,
} from './enrollment-simulator.js';

export interface SimulatorConfig {
  url: string;
  deviceId: string;
  token: string;
  fw: string;
  enroll: EnrollmentOptions;
}

const wsUrl = z.string().refine((value) => {
  try {
    return ['ws:', 'wss:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, 'must be a ws:// or wss:// URL');

/** Env and flags arrive as text: accept plain decimal integers only. */
const intText = (min: number, message: string) =>
  z
    .string()
    .regex(/^\d{1,9}$/, message)
    .transform(Number)
    .refine((value) => value >= min, message);
const nonNegativeInt = intText(0, 'must be a non-negative integer');
const positiveInt = intText(1, 'must be a positive integer');

const configSchema = z.object({
  url: wsUrl,
  deviceId: z.string().min(1, 'must not be empty'),
  token: z.string().min(1, 'is required'),
  fw: z.string().min(1, 'must not be empty'),
  enrollMode: z.enum(ENROLL_MODES, {
    error: `must be one of ${ENROLL_MODES.join(', ')}`,
  }),
  enrollStepMs: nonNegativeInt,
  enrollFailReason: z.string().min(1, 'must not be empty'),
  templateBytes: positiveInt,
});

const OPTIONS = {
  url: { flag: '--url', env: 'SIM_URL' },
  deviceId: { flag: '--device-id', env: 'SIM_DEVICE_ID' },
  token: { flag: '--token', env: 'SIM_DEVICE_TOKEN' },
  fw: { flag: '--fw', env: 'SIM_FW' },
  enrollMode: { flag: '--enroll-mode', env: 'SIM_ENROLL_MODE' },
  enrollStepMs: { flag: '--enroll-step-ms', env: 'SIM_ENROLL_STEP_MS' },
  enrollFailReason: {
    flag: '--enroll-fail-reason',
    env: 'SIM_ENROLL_FAIL_REASON',
  },
  templateBytes: { flag: '--template-bytes', env: 'SIM_TEMPLATE_BYTES' },
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
        'enroll-mode': { type: 'string' },
        'enroll-step-ms': { type: 'string' },
        'enroll-fail-reason': { type: 'string' },
        'template-bytes': { type: 'string' },
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
    enrollMode:
      values['enroll-mode'] ??
      env[OPTIONS.enrollMode.env] ??
      DEFAULT_ENROLLMENT.mode,
    enrollStepMs:
      values['enroll-step-ms'] ??
      env[OPTIONS.enrollStepMs.env] ??
      String(DEFAULT_ENROLLMENT.stepMs),
    enrollFailReason:
      values['enroll-fail-reason'] ??
      env[OPTIONS.enrollFailReason.env] ??
      DEFAULT_ENROLLMENT.failReason,
    templateBytes:
      values['template-bytes'] ??
      env[OPTIONS.templateBytes.env] ??
      String(DEFAULT_ENROLLMENT.templateBytes),
  };

  const result = configSchema.safeParse(candidate);
  if (result.success) {
    const {
      enrollMode,
      enrollStepMs,
      enrollFailReason,
      templateBytes,
      ...rest
    } = result.data;
    return {
      ...rest,
      enroll: {
        mode: enrollMode,
        stepMs: enrollStepMs,
        failReason: enrollFailReason,
        templateBytes,
      },
    };
  }

  // Only option names and rule messages are reported, never the values.
  const problems = result.error.issues.map((issue) => {
    const key = String(issue.path[0]) as keyof typeof OPTIONS;
    const { flag, env: envName } = OPTIONS[key];
    return `${flag} / ${envName} ${issue.message}`;
  });
  throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);
}
