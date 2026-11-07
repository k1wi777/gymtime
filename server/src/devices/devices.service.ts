import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DEVICES_CONFIG,
  defaultDevicesConfig,
  type DevicesConfig,
} from './devices.config.js';
import {
  tokenStatusOf,
  type Device,
  type DeviceStatus,
} from './domain/device.js';
import {
  DEVICE_COMMANDS_REPOSITORY,
  type DeviceCommandsRepository,
} from './domain/device-commands.repository.js';
import {
  DEVICES_REPOSITORY,
  type DevicesRepository,
} from './domain/devices.repository.js';

export type ConnectedListener = (deviceId: string) => Promise<void> | void;
export type RecoveredListener = (deviceId: string) => Promise<void> | void;

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);
  private readonly connectedListeners: ConnectedListener[] = [];
  private readonly recoveredListeners: RecoveredListener[] = [];

  constructor(
    @Inject(DEVICES_REPOSITORY) private readonly repository: DevicesRepository,
    @Inject(DEVICE_COMMANDS_REPOSITORY)
    private readonly commands: DeviceCommandsRepository,
    @Optional()
    @Inject(DEVICES_CONFIG)
    private readonly config: DevicesConfig = defaultDevicesConfig,
  ) {}

  /**
   * Extension point so other modules react to a device being accepted
   * (authenticated and registered) without `devices` depending on them.
   */
  onConnected(listener: ConnectedListener): void {
    this.connectedListeners.push(listener);
  }

  /**
   * Called when a device reconnects after an offline alert fired (the alert
   * is over). Failures are logged and never block the connection.
   */
  onRecovered(listener: RecoveredListener): void {
    this.recoveredListeners.push(listener);
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

  async markOnline(
    deviceId: string,
    firmwareVersion: string,
    at: Date = new Date(),
  ): Promise<void> {
    const { recovered } = await this.repository.upsertOnline(
      deviceId,
      firmwareVersion,
      at,
    );
    if (!recovered) return;
    for (const listener of this.recoveredListeners) {
      try {
        await listener(deviceId);
      } catch (error) {
        this.logger.error({
          event: 'recovered_listener_failed',
          deviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Current delivery status of commands by id (order history). */
  async commandStatuses(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.commands.findByIds(ids);
    return new Map(rows.map((row) => [row.id, row.status]));
  }

  /** Creates the device row if missing (commands need it for the foreign key). */
  ensureDevice(deviceId: string): Promise<void> {
    return this.repository.ensure(deviceId);
  }

  markOffline(deviceId: string, at: Date = new Date()): Promise<void> {
    return this.repository.setOffline(deviceId, at);
  }

  markAllOffline(at: Date = new Date()): Promise<void> {
    return this.repository.setAllOffline(at);
  }

  /** Devices still offline past the threshold that were not alerted yet. */
  async findOverdueOffline(now: Date): Promise<Device[]> {
    const minutes = this.config.offlineAlertMinutes;
    if (minutes <= 0) return [];
    const limit = now.getTime() - minutes * 60_000;
    return (await this.repository.findAll()).filter(
      (device) =>
        device.lastConnectedAt !== null &&
        !device.online &&
        device.offlineAlertedAt === null &&
        device.offlineSince !== null &&
        device.offlineSince.getTime() <= limit,
    );
  }

  claimOfflineAlert(deviceId: string, at: Date): Promise<boolean> {
    return this.repository.markAlerted(deviceId, at);
  }

  get offlineAlertMinutes(): number {
    return this.config.offlineAlertMinutes;
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
        tokenStatus: tokenStatusOf(device),
        offlineSince: device.offlineSince?.toISOString() ?? null,
        offlineAlert: device.offlineAlertedAt !== null,
        alertThresholdMinutes: this.config.offlineAlertMinutes,
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
