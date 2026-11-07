import type { Device } from '../domain/device.js';
import type {
  DevicesRepository,
  TokenState,
} from '../domain/devices.repository.js';

export class InMemoryDevicesRepository implements DevicesRepository {
  private readonly devices = new Map<string, Device>();

  private blank(id: string): Device {
    return {
      id,
      online: false,
      lastConnectedAt: null,
      firmwareVersion: null,
      tokenHash: null,
      tokenCreatedAt: null,
      tokenRevokedAt: null,
      offlineSince: null,
      offlineAlertedAt: null,
    };
  }

  async ensure(id: string) {
    if (!this.devices.has(id)) this.devices.set(id, this.blank(id));
  }

  async upsertOnline(id: string, firmwareVersion: string, at: Date) {
    const before = this.devices.get(id);
    this.devices.set(id, {
      ...(before ?? this.blank(id)),
      online: true,
      lastConnectedAt: at,
      firmwareVersion,
      offlineSince: null,
      offlineAlertedAt: null,
    });
    return { recovered: before?.offlineAlertedAt != null };
  }

  async setOffline(id: string, at: Date) {
    const device = this.devices.get(id);
    if (device) {
      this.devices.set(id, {
        ...device,
        online: false,
        offlineSince: device.offlineSince ?? at,
      });
    }
  }

  async setAllOffline(at: Date) {
    for (const [id, device] of this.devices) {
      this.devices.set(id, {
        ...device,
        online: false,
        offlineSince: device.offlineSince ?? at,
      });
    }
  }

  async markAlerted(id: string, at: Date) {
    const device = this.devices.get(id);
    if (!device || device.online || device.offlineAlertedAt) return false;
    this.devices.set(id, { ...device, offlineAlertedAt: at });
    return true;
  }

  async findAll() {
    return [...this.devices.values()].map((device) => ({ ...device }));
  }

  async findById(id: string) {
    const device = this.devices.get(id);
    return device ? { ...device } : null;
  }

  async setToken(id: string, state: TokenState) {
    const device = this.devices.get(id);
    if (!device) return false;
    this.devices.set(id, { ...device, ...state });
    return true;
  }
}
