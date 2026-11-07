export interface Device {
  id: string;
  online: boolean;
  lastConnectedAt: Date | null;
  firmwareVersion: string | null;
  /** SHA-256 hex of the device's own token; null = none (see `tokenRevokedAt`). */
  tokenHash: string | null;
  tokenCreatedAt: Date | null;
  /** Set when the token was revoked and no new one has been issued. */
  tokenRevokedAt: Date | null;
  /** Since when it is offline (null while online or never seen). */
  offlineSince: Date | null;
  /** When the offline alert fired; one per drop, cleared on reconnection. */
  offlineAlertedAt: Date | null;
  /** Optional features declared in the last hello (empty = a v0 reader). */
  capabilities: string[];
  /** Device clock minus server clock at the last hello, in seconds. */
  clockOffsetSec: number | null;
  clockCheckedAt: Date | null;
}

/** Which credential a device is on: shared DEVICE_TOKEN, its own token, or none. */
export type TokenStatus = 'legacy' | 'own' | 'revoked';

export function tokenStatusOf(
  device: Pick<Device, 'tokenHash' | 'tokenRevokedAt'> | null,
): TokenStatus {
  if (device?.tokenHash) return 'own';
  return device?.tokenRevokedAt ? 'revoked' : 'legacy';
}

/** Shape exposed by GET /devices/status. */
export interface DeviceStatus {
  deviceId: string;
  online: boolean;
  lastConnectedAt: string | null;
  firmwareVersion: string | null;
  /** Commands in `pending` or `sent` that the device has not confirmed. */
  pendingCommands: number;
  tokenStatus: TokenStatus;
  offlineSince: string | null;
  /** True from the alert until the device reconnects. */
  offlineAlert: boolean;
  /** Configured threshold in minutes (0 = alerts disabled). */
  alertThresholdMinutes: number;
}
