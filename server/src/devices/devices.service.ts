import { Inject, Injectable } from '@nestjs/common';
import type { DeviceStatus } from './domain/device.js';
import {
  DEVICES_REPOSITORY,
  type DevicesRepository,
} from './domain/devices.repository.js';

@Injectable()
export class DevicesService {
  constructor(
    @Inject(DEVICES_REPOSITORY) private readonly repository: DevicesRepository,
  ) {}

  markOnline(
    deviceId: string,
    firmwareVersion: string,
    at: Date = new Date(),
  ): Promise<void> {
    return this.repository.upsertOnline(deviceId, firmwareVersion, at);
  }

  markOffline(deviceId: string): Promise<void> {
    return this.repository.setOffline(deviceId);
  }

  markAllOffline(): Promise<void> {
    return this.repository.setAllOffline();
  }

  async listStatus(): Promise<DeviceStatus[]> {
    const devices = await this.repository.findAll();
    return devices.map((device) => ({
      deviceId: device.id,
      online: device.online,
      lastConnectedAt: device.lastConnectedAt?.toISOString() ?? null,
      firmwareVersion: device.firmwareVersion,
    }));
  }
}
