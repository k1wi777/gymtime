import {
  ConnectionRegistry,
  type DeviceConnection,
} from './connection-registry.js';
import { DevicesService } from './devices.service.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';

const connection = (): DeviceConnection => ({ send: vi.fn(), close: vi.fn() });

describe('DevicesService', () => {
  let service: DevicesService;

  beforeEach(() => {
    service = new DevicesService(new InMemoryDevicesRepository());
  });

  it('creates the device online with firmware and last connection', async () => {
    await service.markOnline('d1', '1.2.3', new Date('2026-01-01T00:00:00Z'));
    expect(await service.listStatus()).toEqual([
      {
        deviceId: 'd1',
        online: true,
        lastConnectedAt: '2026-01-01T00:00:00.000Z',
        firmwareVersion: '1.2.3',
      },
    ]);
  });

  it('marks offline keeping the last connection', async () => {
    await service.markOnline('d1', '1.0.0', new Date('2026-01-01T00:00:00Z'));
    await service.markOffline('d1');
    const [status] = await service.listStatus();
    expect(status).toMatchObject({
      online: false,
      lastConnectedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('marks every device offline', async () => {
    await service.markOnline('d1', '1.0.0');
    await service.markOnline('d2', '1.0.0');
    await service.markAllOffline();
    const statuses = await service.listStatus();
    expect(statuses.every((s) => !s.online)).toBe(true);
  });

  describe('getOnlineDeviceId', () => {
    it('is null when no device is online', async () => {
      expect(await service.getOnlineDeviceId()).toBeNull();
      await service.markOnline('d1', '1.0.0');
      await service.markOffline('d1');
      expect(await service.getOnlineDeviceId()).toBeNull();
    });

    it('returns the only online device', async () => {
      await service.markOnline('d1', '1.0.0');
      await service.markOnline('d2', '1.0.0');
      await service.markOffline('d2');
      expect(await service.getOnlineDeviceId()).toBe('d1');
    });

    it('is null when the choice is ambiguous', async () => {
      await service.markOnline('d1', '1.0.0');
      await service.markOnline('d2', '1.0.0');
      expect(await service.getOnlineDeviceId()).toBeNull();
    });
  });
});

describe('ConnectionRegistry', () => {
  it('returns the replaced connection and ignores its late unregister', () => {
    const registry = new ConnectionRegistry();
    const first = connection();
    const second = connection();
    expect(registry.register('d1', first)).toBeUndefined();
    expect(registry.register('d1', second)).toBe(first);
    expect(registry.unregister('d1', first)).toBe(false);
    expect(registry.get('d1')).toBe(second);
    expect(registry.unregister('d1', second)).toBe(true);
    expect(registry.get('d1')).toBeUndefined();
  });
});
