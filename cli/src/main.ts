#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { run } from './cli.js';

/** Missing file is a valid state (`undefined`); other errors propagate. */
function readFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function main(): Promise<void> {
  // Ctrl+C aborts the signal so a running command can clean up before exit.
  const interrupt = new AbortController();
  process.on('SIGINT', () => {
    if (interrupt.signal.aborted) process.exit(130);
    interrupt.abort();
  });

  const code = await run(process.argv.slice(2), {
    env: process.env,
    readFile,
    signal: interrupt.signal,
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  });
  process.exitCode = code;
}

main().catch(() => {
  // Unexpected failure: no stack, which could expose request data.
  console.error('Error: unexpected failure');
  process.exitCode = 1;
});
