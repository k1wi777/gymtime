import { CliError } from '../errors.js';
import { HttpError } from '../http.js';
import type { SystemEvent } from '../stream.js';
import { formatBogotaClock } from '../time.js';
import { noPositionals } from './args.js';
import type { Command } from './types.js';

/** Backoff after a lost stream: 1, 2, 4, 8 and 10 s (top). */
const RETRY_MS = [1000, 2000, 4000, 8000, 10_000] as const;

const watch: Command = {
  group: 'watch',
  action: '',
  summary: 'Stream system events live (connections, scans, orders, alarm)',
  usage: 'watch',
  async run(ctx) {
    const { http, io, url, signal, positionals } = ctx;
    noPositionals(positionals);
    io.out(`Watching ${url}/events (Ctrl+C to stop).`);
    let attempt = 0;
    while (!signal.aborted) {
      try {
        for await (const event of http.stream('/events', { signal })) {
          if (signal.aborted) break;
          attempt = 0;
          if (event.type === 'keepalive') continue;
          io.out(line(event));
        }
      } catch (error) {
        if (signal.aborted) break;
        // A rejected key never fixes itself: exit without retrying.
        if (error instanceof HttpError && error.status === 401) throw error;
        if (!(error instanceof CliError)) throw error;
      }
      if (signal.aborted) break;
      const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
      attempt = Math.min(attempt + 1, RETRY_MS.length - 1);
      io.out(`Connection lost; reconnecting in ${wait / 1000}s...`);
      await ctx.sleep(wait, signal);
    }
    io.out('Stopped.');
    return 0;
  },
};

function line(event: SystemEvent): string {
  return `${formatBogotaClock(event.at)}  ${event.type}  ${detail(event)}`;
}

function detail(event: SystemEvent): string {
  const data = event.data;
  switch (event.type) {
    case 'device.connected':
      return `device ${text(data['deviceId'])} connected (fw ${text(data['firmwareVersion'])})`;
    case 'device.disconnected':
      return `device ${text(data['deviceId'])} disconnected (${text(data['reason'])})`;
    case 'scan': {
      const who = data['studentName'] ? ` ${text(data['studentName'])}` : '';
      const why = data['reason'] ? `: ${text(data['reason'])}` : '';
      return `slot ${text(data['slot'])} ${text(data['result'])}${who}${why}`;
    }
    case 'command':
      return `${text(data['commandType'])} ${text(data['commandId'])} ${text(data['status'])} (attempts ${text(data['attempts'])})`;
    case 'alarm': {
      const state = data['on'] ? 'on' : 'off';
      const closedBy = data['closedBy'] ? ` by ${text(data['closedBy'])}` : '';
      return `alarm ${state} (${text(data['reason'])})${closedBy}`;
    }
    default:
      return JSON.stringify(data);
  }
}

function text(value: unknown): string {
  if (value === undefined || value === null) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export const watchCommands: readonly Command[] = [watch];
