export interface Device {
  id: string;
  online: boolean;
  lastConnectedAt: Date | null;
  firmwareVersion: string | null;
}

/** Shape exposed by GET /devices/status. */
export interface DeviceStatus {
  deviceId: string;
  online: boolean;
  lastConnectedAt: string | null;
  firmwareVersion: string | null;
  /** Commands in `pending` or `sent` that the device has not confirmed. */
  pendingCommands: number;
}
