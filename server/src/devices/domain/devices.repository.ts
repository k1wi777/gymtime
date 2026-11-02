import type { Device } from './device.js';

export interface DevicesRepository {
  /** Creates the device row if missing, without touching its online state. */
  ensure(id: string): Promise<void>;
  /** Creates the device if missing and marks it online. */
  upsertOnline(id: string, firmwareVersion: string, at: Date): Promise<void>;
  /** Marks the device offline, keeping its last connection. */
  setOffline(id: string): Promise<void>;
  setAllOffline(): Promise<void>;
  findAll(): Promise<Device[]>;
}

export const DEVICES_REPOSITORY = Symbol('DEVICES_REPOSITORY');
