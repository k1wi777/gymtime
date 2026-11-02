/** Lifecycle of a persisted command; maps 1:1 to the `command_status` enum. */
export type DeviceCommandStatus = 'pending' | 'sent' | 'acked' | 'failed';

export interface DeviceCommand {
  /** Same id as the protocol message: retries and replays reuse it. */
  id: string;
  deviceId: string;
  type: string;
  /** JSON payload of the message; the envelope is rebuilt before sending. */
  payload: unknown;
  status: DeviceCommandStatus;
  attempts: number;
  createdAt: Date;
}

export interface NewDeviceCommand {
  id: string;
  deviceId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}
