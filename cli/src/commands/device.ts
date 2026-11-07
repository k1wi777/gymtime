import { DISPLAY_DEFAULTS, validateDisplayLines } from '@gymtime/shared';
import { CliError, UsageError } from '../errors.js';
import { formatBogota } from '../time.js';
import { formatTable, yesNo } from '../output.js';
import { noPositionals } from './args.js';
import type { Command, CommandContext } from './types.js';

interface DeviceStatus {
  deviceId: string;
  online: boolean;
  lastConnectedAt: string | null;
  firmwareVersion: string | null;
  /** Absent on older servers, where it counts as zero. */
  pendingCommands?: number;
  /** Absent on servers older than H11, where every device is `legacy`. */
  tokenStatus?: 'legacy' | 'own' | 'revoked';
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
        [
          'device',
          'online',
          'last connection (Bogota)',
          'firmware',
          'pending',
          'token',
        ],
        devices.map((device) => [
          device.deviceId,
          yesNo(device.online),
          device.lastConnectedAt
            ? formatBogota(device.lastConnectedAt)
            : 'never',
          device.firmwareVersion ?? '-',
          String(device.pendingCommands ?? 0),
          device.tokenStatus ?? 'legacy',
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

interface IssuedToken {
  deviceId: string;
  token: string;
}

/** Same rule as the server: letters, digits, dot, dash, underscore. */
function deviceIdArg(positionals: string[]): string {
  const [id, ...extra] = positionals;
  if (!id) throw new UsageError('expected the device id');
  if (extra.length > 0)
    throw new UsageError(`unexpected argument "${extra[0]}"`);
  return id;
}

/** The token is shown once and never goes through the command line. */
function showToken(io: CommandContext['io'], issued: IssuedToken): void {
  io.out(`Token for ${issued.deviceId} (shown ONCE, copy it now):`);
  io.out('');
  io.out(`  ${issued.token}`);
  io.out('');
  io.out(
    'Flash it into the device firmware. The server keeps only its hash; if it is lost, run `gym device rotate`.',
  );
}

const registerCommand: Command = {
  group: 'device',
  action: 'register',
  summary: 'Register a device and issue its own token (shown once; admin)',
  usage: 'device register <id>',
  async run({ http, io, positionals }) {
    const issued = await http.request<IssuedToken>('POST', '/devices', {
      deviceId: deviceIdArg(positionals),
    });
    showToken(io, issued);
    return 0;
  },
};

const rotateCommand: Command = {
  group: 'device',
  action: 'rotate',
  summary:
    'Replace the token: the old one stops working at once and the connection closes (admin)',
  usage: 'device rotate <id>',
  async run({ http, io, positionals }) {
    const id = deviceIdArg(positionals);
    const issued = await http.request<IssuedToken>(
      'POST',
      `/devices/${encodeURIComponent(id)}/token/rotate`,
    );
    showToken(io, issued);
    return 0;
  },
};

const revokeCommand: Command = {
  group: 'device',
  action: 'revoke',
  summary:
    'Revoke the token: the device is refused until it is rotated (admin)',
  usage: 'device revoke <id> --yes',
  options: { yes: { type: 'boolean' } },
  async run({ http, io, values, positionals }) {
    const id = deviceIdArg(positionals);
    if (values['yes'] !== true) {
      throw new UsageError(
        `revoking ${id} disconnects it and refuses it until a new token is issued; repeat with --yes to confirm`,
      );
    }
    await http.request(
      'POST',
      `/devices/${encodeURIComponent(id)}/token/revoke`,
    );
    io.out(
      `Token of ${id} revoked. Use \`gym device rotate ${id}\` to issue a new one.`,
    );
    return 0;
  },
};

export const deviceCommands: readonly Command[] = [
  statusCommand,
  messageCommand,
  registerCommand,
  rotateCommand,
  revokeCommand,
];
