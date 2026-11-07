import type { DeviceStatus, EventOf, SystemEvent } from '@/api/types';

export const MAX_SCANS = 20;
export const MAX_COMMANDS = 10;

export type ScanEntry = EventOf<'scan'> & { key: string };

/** Newest first, bounded. Includes rejected scans (they carry the reason). */
export function pushScan(
  feed: readonly ScanEntry[],
  event: EventOf<'scan'>,
): ScanEntry[] {
  const entry: ScanEntry = { ...event, key: `${event.at}:${feed.length}` };
  return [entry, ...feed].slice(0, MAX_SCANS);
}

export interface CommandEntry {
  commandId: string;
  deviceId: string;
  commandType: string;
  status: EventOf<'command'>['data']['status'];
  attempts: number;
  at: string;
}

/** One row per command: later events of the same id update it in place. */
export function applyCommand(
  list: readonly CommandEntry[],
  event: EventOf<'command'>,
): CommandEntry[] {
  const entry: CommandEntry = { ...event.data, at: event.at };
  const index = list.findIndex((item) => item.commandId === entry.commandId);
  if (index === -1) return [entry, ...list].slice(0, MAX_COMMANDS);
  const next = [...list];
  next[index] = { ...entry, at: next[index]?.at ?? entry.at };
  return next;
}

/** Applies a connection event to the known devices; other events change nothing. */
export function applyDeviceEvent(
  devices: readonly DeviceStatus[],
  event: SystemEvent,
): DeviceStatus[] {
  if (event.type === 'device.connected') {
    const { deviceId, firmwareVersion } = event.data;
    const known = devices.find((d) => d.deviceId === deviceId);
    const updated: DeviceStatus = {
      pendingCommands: known?.pendingCommands ?? 0,
      tokenStatus: known?.tokenStatus ?? 'legacy',
      deviceId,
      online: true,
      lastConnectedAt: event.at,
      firmwareVersion,
      offlineSince: null,
      offlineAlert: false,
      alertThresholdMinutes: known?.alertThresholdMinutes ?? 0,
    };
    return known
      ? devices.map((d) => (d.deviceId === deviceId ? updated : d))
      : [...devices, updated];
  }
  if (event.type === 'device.disconnected') {
    return devices.map((d) =>
      d.deviceId === event.data.deviceId
        ? { ...d, online: false, offlineSince: d.offlineSince ?? event.at }
        : d,
    );
  }
  if (event.type === 'device.offline_alert') {
    return devices.map((d) =>
      d.deviceId === event.data.deviceId
        ? {
            ...d,
            online: false,
            offlineAlert: true,
            alertThresholdMinutes: event.data.thresholdMinutes,
          }
        : d,
    );
  }
  return [...devices];
}
