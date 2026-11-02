import type { Device } from '../domain/device.js';
import type { DevicesRepository } from '../domain/devices.repository.js';

export class InMemoryDevicesRepository implements DevicesRepository {
  private readonly devices = new Map<string, Device>();

  async upsertOnline(id: string, firmwareVersion: string, at: Date) {
    this.devices.set(id, {
      id,
      online: true,
      lastConnectedAt: at,
      firmwareVersion,
    });
  }

  async setOffline(id: string) {
    const device = this.devices.get(id);
    if (device) this.devices.set(id, { ...device, online: false });
  }

  async setAllOffline() {
    for (const [id, device] of this.devices) {
      this.devices.set(id, { ...device, online: false });
    }
  }

  async findAll() {
    return [...this.devices.values()];
  }
}
