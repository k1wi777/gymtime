import { DISPLAY_DEFAULTS, validateDisplayLines } from '@gymtime/shared';
import { CliError, UsageError } from '../errors.js';
import { formatBogota } from '../time.js';
import { formatTable, yesNo } from '../output.js';
import { noPositionals } from './args.js';
import type { Command } from './types.js';

interface DeviceStatus {
  deviceId: string;
  online: boolean;
  lastConnectedAt: string | null;
  firmwareVersion: string | null;
  /** Absent on older servers, where it counts as zero. */
  pendingCommands?: number;
}

const statusCommand: Command = {
  group: 'device',
  action: 'status',
  summary: 'Show every known device: online, last connection, firmware, queue',
  usage: 'device status',
  async run({ http, io, positionals }) {
    noPositionals(positionals);
    const devices = await http.request<DeviceStatus[]>(
      'GET',
      '/devices/status',
    );
    if (devices.length === 0) {
      io.out('No devices registered yet.');
      return 0;
    }
    io.out(
      formatTable(
        ['device', 'online', 'last connection (Bogota)', 'firmware', 'pending'],
        devices.map((device) => [
          device.deviceId,
          yesNo(device.online),
          device.lastConnectedAt
            ? formatBogota(device.lastConnectedAt)
            : 'never',
          device.firmwareVersion ?? '-',
          String(device.pendingCommands ?? 0),
        ]),
      ),
    );
    return 0;
  },
};

interface MessageResult {
  commandId: string;
  deviceId: string;
  status: 'acked' | 'queued' | 'failed';
}

const MAX_SECONDS = 60;

function parseSeconds(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value) ||
    seconds < 1 ||
    seconds > MAX_SECONDS
  ) {
    throw new UsageError(
      `--seconds must be a whole number from 1 to ${MAX_SECONDS}`,
    );
  }
  return seconds;
}

const messageCommand: Command = {
  group: 'device',
  action: 'message',
  summary: 'Show a message on the reader LCD (16x2, accents are removed)',
  usage: 'device message <line1> [line2] [--seconds N] [--device ID]',
  options: {
    seconds: { type: 'string' },
    device: { type: 'string' },
  },
  async run({ http, io, values, positionals }) {
    if (positionals.length === 0) {
      throw new UsageError('expected the text of line 1');
    }
    // The server enforces the real DISPLAY_COLS/ROWS; this fails fast with
    // the default size and the same normalization.
    const checked = validateDisplayLines(positionals, DISPLAY_DEFAULTS);
    if (!checked.ok) {
      throw new CliError(checked.errors.map((e) => e.message).join('; '));
    }
    const [line1, line2] = checked.lines;
    if (line1 === '') throw new UsageError('line 1 cannot be empty');
    const device = values['device'];
    const result = await http.request<MessageResult>(
      'POST',
      '/devices/messages',
      {
        deviceId: typeof device === 'string' ? device : undefined,
        line1,
        line2,
        durationSec: parseSeconds(values['seconds']),
      },
    );
    if (result.status === 'failed') {
      throw new CliError(
        `The device ${result.deviceId} did not confirm the message (order ${result.commandId}).`,
      );
    }
    io.out(
      result.status === 'queued'
        ? `Message queued for ${result.deviceId}: it will be shown when the device reconnects.`
        : `Message shown on ${result.deviceId}.`,
    );
    return 0;
  },
};

export const deviceCommands: readonly Command[] = [
  statusCommand,
  messageCommand,
];
