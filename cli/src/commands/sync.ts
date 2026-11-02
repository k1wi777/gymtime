import { CliError } from '../errors.js';
import { HttpError } from '../http.js';
import { noPositionals } from './args.js';
import type { Command } from './types.js';

interface SyncResult {
  status: 'ok' | 'failed';
  deviceId: string;
  templates: number;
  chunks: number;
  scheduleId: string | null;
  omitted: number;
  error: string | null;
}

/** Up to 17 sequential chunks, each waiting for the reader's ack. */
const SYNC_TIMEOUT_MS = 120_000;

const sync: Command = {
  group: 'sync',
  action: '',
  summary: 'Load the current templates and schedule into the online reader',
  usage: 'sync',
  async run({ http, io, positionals }) {
    noPositionals(positionals);
    let result: SyncResult;
    try {
      result = await http.request<SyncResult>('POST', '/sync', undefined, {
        timeoutMs: SYNC_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        throw new CliError(`Nothing was synced. ${error.message}`);
      }
      throw error;
    }
    if (result.status === 'failed') {
      io.err(
        `Sync to ${result.deviceId} failed after ${result.chunks} chunk(s) and ${result.templates} template(s): ${result.error ?? 'unknown error'}`,
      );
      return 1;
    }
    io.out(
      `Synced ${result.deviceId}: ${result.templates} template(s) in ${result.chunks} chunk(s).`,
    );
    io.out(
      result.scheduleId
        ? `Schedule ${result.scheduleId} sent to the reader.`
        : 'No schedule to send.',
    );
    if (result.omitted > 0) {
      io.out(
        `Warning: ${result.omitted} student(s) left out for lack of reader slots.`,
      );
    }
    return 0;
  },
};

export const syncCommands: readonly Command[] = [sync];
