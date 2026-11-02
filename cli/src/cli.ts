import { parseArgs } from 'node:util';
import { COMMANDS, GROUP_SUMMARIES } from './commands/index.js';
import type { Command, Io } from './commands/types.js';
import { resolveConfig } from './config.js';
import { CliError, ConfigError, UsageError } from './errors.js';
import { createHttpClient, type FetchLike } from './http.js';

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export interface Runtime extends Io {
  env: NodeJS.ProcessEnv;
  readFile: (path: string) => string | undefined;
  fetch?: FetchLike;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  pollMs?: number;
}

const GLOBAL_OPTIONS = {
  url: { type: 'string' },
  'api-key': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

const GLOBAL_HELP = [
  'Global options:',
  '  --url <url>         Server URL (env GYM_URL, default http://localhost:3000)',
  '  --api-key <key>     Admin API key (env GYM_API_KEY); prefer the variable or',
  '                      the file, since options stay in the shell history',
  '  -h, --help          Show help',
  '',
  'Configuration file: ~/.config/gymtime/cli.json ({"url": "...", "apiKey": "..."}),',
  'path overridable with GYM_CONFIG. Precedence: option > variable > file > default.',
];

/** Runs one invocation and returns the process exit code (no process effects). */
export async function run(argv: string[], runtime: Runtime): Promise<number> {
  const { group, command, args } = route(argv);
  try {
    if (group === undefined) {
      runtime.out(rootHelp());
      return EXIT_OK;
    }
    if (command === 'group-help') {
      runtime.out(groupHelp(group));
      return EXIT_OK;
    }
    return await execute(command, args, runtime);
  } catch (error) {
    return report(error, runtime, command, group);
  }
}

type Route =
  | { group: undefined; command?: undefined; args: string[] }
  | { group: string; command: 'group-help' | Command; args: string[] };

function route(argv: string[]): Route {
  const [group, action] = argv;
  if (group === undefined || isHelp(group)) {
    return { group: undefined, command: undefined, args: [] };
  }
  const known = COMMANDS.filter((c) => c.group === group);
  if (known.length === 0) {
    return {
      group,
      command: unknown(`Unknown command group "${group}"`),
      args: [],
    };
  }
  // A group with a single action-less command (`gym sync`) takes options directly.
  const direct = known.find((c) => c.action === '');
  if (direct && (action === undefined || action.startsWith('-'))) {
    return { group, command: direct, args: argv.slice(1) };
  }
  if (action === undefined || isHelp(action)) {
    return { group, command: 'group-help', args: [] };
  }
  const command = known.find((c) => c.action === action);
  return {
    group,
    command: command ?? unknown(`Unknown action "${action}" for "${group}"`),
    args: argv.slice(2),
  };
}

/** A placeholder command that fails with a usage error when executed. */
function unknown(message: string): Command {
  return {
    group: '',
    action: '',
    summary: '',
    usage: '',
    run: () => Promise.reject(new UsageError(message)),
  };
}

async function execute(
  command: Command,
  args: string[],
  runtime: Runtime,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { ...GLOBAL_OPTIONS, ...command.options },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    // The parseArgs message names the offending flag, never a value.
    throw new UsageError((error as Error).message);
  }
  const values = parsed.values as Record<
    string,
    string | boolean | string[] | undefined
  >;
  if (values['help']) {
    runtime.out(commandHelp(command));
    return EXIT_OK;
  }

  const config = resolveConfig({
    options: {
      url: values['url'] as string | undefined,
      apiKey: values['api-key'] as string | undefined,
    },
    env: runtime.env,
    readFile: (path) => runtime.readFile(path),
  });
  return command.run({
    http: createHttpClient({ ...config, fetch: runtime.fetch }),
    io: { out: (t) => runtime.out(t), err: (t) => runtime.err(t) },
    url: config.url,
    values,
    positionals: parsed.positionals,
    signal: runtime.signal ?? new AbortController().signal,
    sleep: (ms, signal) => (runtime.sleep ?? defaultSleep)(ms, signal),
    now: () => (runtime.now ?? Date.now)(),
    pollMs: runtime.pollMs ?? 500,
  });
}

function report(
  error: unknown,
  runtime: Runtime,
  command: Route['command'],
  group: string | undefined,
): number {
  if (error instanceof UsageError) {
    runtime.err(`Error: ${error.message}`);
    runtime.err('');
    runtime.err(
      command && command !== 'group-help' && command.usage
        ? commandUsage(command)
        : group
          ? groupHelp(group)
          : rootHelp(),
    );
    return EXIT_USAGE;
  }
  if (error instanceof ConfigError || error instanceof CliError) {
    runtime.err(`Error: ${error.message}`);
    return EXIT_FAILURE;
  }
  throw error;
}

function isHelp(arg: string): boolean {
  return arg === '--help' || arg === '-h' || arg === 'help';
}

function commandUsage(command: Command): string {
  return `Usage: gym ${command.usage}`;
}

function commandHelp(command: Command): string {
  return [commandUsage(command), '', command.summary, '', ...GLOBAL_HELP].join(
    '\n',
  );
}

function groupHelp(group: string): string {
  const actions = COMMANDS.filter((c) => c.group === group);
  return [
    `Usage: gym ${group} <action> [options]`,
    '',
    GROUP_SUMMARIES[group] ?? '',
    '',
    'Actions:',
    ...actions.flatMap((c) => [`  ${c.usage}`, `      ${c.summary}`]),
    '',
    ...GLOBAL_HELP,
  ].join('\n');
}

function rootHelp(): string {
  const lines = Object.entries(GROUP_SUMMARIES).flatMap(([group, summary]) => [
    `  ${group}`,
    `      ${summary}`,
    ...COMMANDS.filter((c) => c.group === group).flatMap((c) => [
      `      ${c.usage}`,
      `          ${c.summary}`,
    ]),
  ]);
  return [
    'gym - GymTime administration CLI',
    '',
    'Usage: gym <group> <action> [options]',
    '',
    'Commands:',
    ...lines,
    '',
    ...GLOBAL_HELP,
  ].join('\n');
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
