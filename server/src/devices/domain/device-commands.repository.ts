import type { DeviceCommand, NewDeviceCommand } from './device-command.js';

/** Queue of commands that must survive a lost connection or a restart. */
export interface DeviceCommandsRepository {
  create(command: NewDeviceCommand): Promise<void>;
  findById(id: string): Promise<DeviceCommand | null>;
  /** `sent` with the number of transmissions so far. */
  markSent(id: string, attempts: number): Promise<void>;
  markAcked(id: string): Promise<void>;
  markFailed(id: string): Promise<void>;
  /** Returns it to the queue after a connection loss. */
  markPending(id: string): Promise<void>;
  /** `pending` or `sent`, i.e. not confirmed yet. */
  countUnconfirmed(deviceId: string): Promise<number>;
  /** `pending` rows of a device, oldest first (FIFO replay). */
  findPendingForDevice(deviceId: string): Promise<DeviceCommand[]>;
  /** Unconfirmed rows of one type, for state-setting commands (R7). */
  findUnconfirmedForDevice(
    deviceId: string,
    type: string,
  ): Promise<DeviceCommand[]>;
  /** Turns rows left `sent` by a crash back into `pending`. */
  resetSentToPending(): Promise<number>;
}

export const DEVICE_COMMANDS_REPOSITORY = Symbol('DEVICE_COMMANDS_REPOSITORY');
