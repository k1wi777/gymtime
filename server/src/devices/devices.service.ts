import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventLogService } from '../common/audit/event-log.service.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import {
  DEFAULT_CLOCK_WARN_SEC,
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

/** Optional fields of `hello` (H12); a v0 reader sends none of them. */
export interface HelloExtras {
  capabilities?: string[];
  /** Device clock, Unix seconds. */
  deviceTime?: number;
  /** Events still in the reader's offline queue. */
  queued?: number;
}

/** What the current connection of a device declared in its `hello`. */
export interface HelloInfo {
  capabilities: string[];
  queued: number;
  at: Date;
}

/** Clock check and capabilities of a device, for the panel. */
export interface DeviceClockStatus {
  deviceId: string;
  capabilities: string[];
  clockOffsetSec: number | null;
  clockCheckedAt: string | null;
  clockWarning: boolean;
  clockThresholdSec: number;
}

export type ConnectedListener = (deviceId: string) => Promise<void> | void;
export type RecoveredListener = (deviceId: string) => Promise<void> | void;

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);
  private readonly connectedListeners: ConnectedListener[] = [];
  private readonly recoveredListeners: RecoveredListener[] = [];
  private readonly hellos = new Map<string, HelloInfo>();

  constructor(
    @Inject(DEVICES_REPOSITORY) private readonly repository: DevicesRepository,
    @Inject(DEVICE_COMMANDS_REPOSITORY)
    private readonly commands: DeviceCommandsRepository,
    @Optional()
    @Inject(DEVICES_CONFIG)
    private readonly config: DevicesConfig = defaultDevicesConfig,
    @Optional() private readonly eventLog?: EventLogService,
    @Optional() private readonly systemEvents?: SystemEventsService,
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
    hello: HelloExtras = {},
  ): Promise<void> {
    const capabilities = hello.capabilities ?? [];
    const { recovered } = await this.repository.upsertOnline(
      deviceId,
      firmwareVersion,
      at,
      capabilities,
    );
    this.hellos.set(deviceId, {
      capabilities,
      queued: hello.queued ?? 0,
      at,
    });
    if (hello.deviceTime !== undefined) {
      await this.checkClock(deviceId, hello.deviceTime, at);
    }
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

  /** What the live connection of the device declared; undefined if none yet. */
  helloInfo(deviceId: string): HelloInfo | undefined {
    return this.hellos.get(deviceId);
  }

  /**
   * Measures device time minus server time. It is only measured and warned
   * about (never used to correct event times): the offset of a reconnection
   * is not the one the reader had while it was cut off. Audited and published
   * only when it crosses the threshold in either direction.
   */
  private async checkClock(
    deviceId: string,
    deviceTime: number,
    at: Date,
  ): Promise<void> {
    const offsetSec = deviceTime - Math.floor(at.getTime() / 1000);
    const threshold = this.clockThresholdSec;
    const before = await this.repository.findById(deviceId);
    const wasWarning =
      before?.clockOffsetSec != null &&
      Math.abs(before.clockOffsetSec) > threshold;
    const warning = Math.abs(offsetSec) > threshold;
    await this.repository.setClock(deviceId, offsetSec, at);
    if (warning === wasWarning) return;
    this.logger.warn({ event: 'clock_skew', deviceId, offsetSec, warning });
    this.systemEvents?.emit('device.clock_skew', {
      deviceId,
      offsetSec,
      thresholdSec: threshold,
      warning,
    });
    await this.eventLog?.record('device.clock_skew', {
      deviceId,
      offsetSec,
      thresholdSec: threshold,
      warning,
    });
  }

  /** Clock measurement of every device, for the panel's device screen. */
  async listClockStatus(): Promise<DeviceClockStatus[]> {
    const threshold = this.clockThresholdSec;
    return (await this.repository.findAll()).map((device) => ({
      deviceId: device.id,
      capabilities: device.capabilities,
      clockOffsetSec: device.clockOffsetSec,
      clockCheckedAt: device.clockCheckedAt?.toISOString() ?? null,
      clockWarning:
        device.clockOffsetSec !== null &&
        Math.abs(device.clockOffsetSec) > threshold,
      clockThresholdSec: threshold,
    }));
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

  private get clockThresholdSec(): number {
    return this.config.clockWarnSec ?? DEFAULT_CLOCK_WARN_SEC;
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
