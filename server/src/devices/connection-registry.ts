import { Injectable } from '@nestjs/common';
import type { ServerMessage } from '@gymtime/shared';

/** Close code when the device token was rotated or revoked (4410). */
export const CLOSE_TOKEN_CHANGED = 4410;

/** Transport-agnostic handle to one live device connection. */
export interface DeviceConnection {
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** Tracks the single active connection per device. */
@Injectable()
export class ConnectionRegistry {
  private readonly active = new Map<string, DeviceConnection>();

  /** Makes `connection` the active one and returns the one it replaces. */
  register(
    deviceId: string,
    connection: DeviceConnection,
  ): DeviceConnection | undefined {
    const previous = this.active.get(deviceId);
    this.active.set(deviceId, connection);
    return previous === connection ? undefined : previous;
  }

  /** Returns true only if `connection` was the active one (not replaced). */
  unregister(deviceId: string, connection: DeviceConnection): boolean {
    if (this.active.get(deviceId) !== connection) return false;
    this.active.delete(deviceId);
    return true;
  }

  get(deviceId: string): DeviceConnection | undefined {
    return this.active.get(deviceId);
  }
}
