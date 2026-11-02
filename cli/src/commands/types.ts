import type { ParseArgsOptionsConfig } from 'node:util';
import type { HttpClient } from '../http.js';

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface CommandContext {
  http: HttpClient;
  io: Io;
  /** Parsed option values of the command (global ones included). */
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
  /** Aborted when the operator interrupts the process (Ctrl+C). */
  signal: AbortSignal;
  /** Resolves after `ms`, or early (without error) when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Current time in milliseconds. */
  now(): number;
  pollMs: number;
}

export interface Command {
  group: string;
  /** Empty for a command invoked as just `gym <group>` (e.g. `gym sync`). */
  action: string;
  summary: string;
  /** Usage without the leading `gym `, e.g. `student add --document <doc>`. */
  usage: string;
  options?: ParseArgsOptionsConfig;
  /** Returns the process exit code. */
  run(ctx: CommandContext): Promise<number>;
}
