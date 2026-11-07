import type { Device } from './device.js';

export interface TokenState {
  tokenHash: string | null;
  tokenCreatedAt: Date | null;
  tokenRevokedAt: Date | null;
}

export interface DevicesRepository {
  /** Creates the device row if missing, without touching its online state. */
  ensure(id: string): Promise<void>;
  /**
   * Creates the device if missing and marks it online, clearing the offline
   * markers. Returns whether an offline alert was active (it has recovered).
   */
  upsertOnline(
    id: string,
    firmwareVersion: string,
    at: Date,
    capabilities?: string[],
  ): Promise<{ recovered: boolean }>;
  /** Stores the last measured clock offset of the device. */
  setClock(id: string, offsetSec: number, at: Date): Promise<void>;
  /** Marks the device offline, keeping its last connection. */
  setOffline(id: string, at: Date): Promise<void>;
  /** Every device goes offline; an `offlineSince` already set is kept. */
  setAllOffline(at: Date): Promise<void>;
  /**
   * Claims the alert of a device that is still offline: true only for the one
   * caller that set `offlineAlertedAt`, so a race never alerts twice.
   */
  markAlerted(id: string, at: Date): Promise<boolean>;
  findAll(): Promise<Device[]>;
  findById(id: string): Promise<Device | null>;
  /** Replaces the token state of an existing device; false when it is missing. */
  setToken(id: string, state: TokenState): Promise<boolean>;
}

export const DEVICES_REPOSITORY = Symbol('DEVICES_REPOSITORY');
