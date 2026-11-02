import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DeviceStatus } from './domain/device.js';
import {
  DEVICE_COMMANDS_REPOSITORY,
  type DeviceCommandsRepository,
} from './domain/device-commands.repository.js';
import {
  DEVICES_REPOSITORY,
  type DevicesRepository,
} from './domain/devices.repository.js';

export type ConnectedListener = (deviceId: string) => Promise<void> | void;

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);
  private readonly connectedListeners: ConnectedListener[] = [];

  constructor(
    @Inject(DEVICES_REPOSITORY) private readonly repository: DevicesRepository,
    @Inject(DEVICE_COMMANDS_REPOSITORY)
    private readonly commands: DeviceCommandsRepository,
  ) {}

  /**
   * Extension point so other modules react to a device being accepted
   * (authenticated and registered) without `devices` depending on them.
   */
  onConnected(listener: ConnectedListener): void {
    this.connectedListeners.push(listener);
  }

  /**
   * Runs the connected listeners one after another. A failing listener is
   * logged and never stops the others nor the caller, who should not await
   * it: `hello.ok` must not wait for them.
   */
  async notifyConnected(deviceId: string): Promise<void> {
    for (const listener of this.connectedListeners) {
      try {
        await listener(deviceId);
      } catch (error) {
        this.logger.error({
          event: 'connected_listener_failed',
          deviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  markOnline(
    deviceId: string,
    firmwareVersion: string,
    at: Date = new Date(),
  ): Promise<void> {
    return this.repository.upsertOnline(deviceId, firmwareVersion, at);
  }

  /** Creates the device row if missing (commands need it for the foreign key). */
  ensureDevice(deviceId: string): Promise<void> {
    return this.repository.ensure(deviceId);
  }

  markOffline(deviceId: string): Promise<void> {
    return this.repository.setOffline(deviceId);
  }

  markAllOffline(): Promise<void> {
    return this.repository.setAllOffline();
  }

  async listStatus(): Promise<DeviceStatus[]> {
    const devices = await this.repository.findAll();
    return Promise.all(
      devices.map(async (device) => ({
        deviceId: device.id,
        online: device.online,
        lastConnectedAt: device.lastConnectedAt?.toISOString() ?? null,
        firmwareVersion: device.firmwareVersion,
        pendingCommands: await this.commands.countUnconfirmed(device.id),
      })),
    );
  }

  /**
   * Id of the only device currently online. Null when none is online or when
   * several are (ambiguous: the caller must name the device).
   */
  async getOnlineDeviceId(): Promise<string | null> {
    const online = (await this.repository.findAll()).filter((d) => d.online);
    return online.length === 1 ? (online[0]?.id ?? null) : null;
  }

  /**
   * Id of the only known device, online or not. Used to queue orders for a
   * single-device deployment instead of failing when it is disconnected.
   */
  async getOnlyDeviceId(): Promise<string | null> {
    const devices = await this.repository.findAll();
    return devices.length === 1 ? (devices[0]?.id ?? null) : null;
  }
}
