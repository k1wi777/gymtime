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

export const deviceCommands: readonly Command[] = [statusCommand];
