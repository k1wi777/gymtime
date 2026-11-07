import {
  ConnectionRegistry,
  type DeviceConnection,
} from './connection-registry.js';
import { DevicesService } from './devices.service.js';
import { InMemoryDeviceCommandsRepository } from './infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';

const connection = (): DeviceConnection => ({ send: vi.fn(), close: vi.fn() });

describe('DevicesService', () => {
  let service: DevicesService;
  let commands: InMemoryDeviceCommandsRepository;

  beforeEach(() => {
    commands = new InMemoryDeviceCommandsRepository();
    service = new DevicesService(new InMemoryDevicesRepository(), commands);
  });

  it('creates the device online with firmware and last connection', async () => {
    await service.markOnline('d1', '1.2.3', new Date('2026-01-01T00:00:00Z'));
    expect(await service.listStatus()).toEqual([
      {
        deviceId: 'd1',
        online: true,
        lastConnectedAt: '2026-01-01T00:00:00.000Z',
        firmwareVersion: '1.2.3',
        pendingCommands: 0,
        tokenStatus: 'legacy',
        offlineSince: null,
        offlineAlert: false,
        alertThresholdMinutes: 5,
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

  it('counts unconfirmed commands per device', async () => {
    await service.markOnline('d1', '1.0.0');
    const command = (id: string) => ({
      id,
      deviceId: 'd1',
      type: 'alarm.set',
      payload: { on: true },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await commands.create(command('00000000-0000-4000-8000-000000000001'));
    await commands.markSent('00000000-0000-4000-8000-000000000001', 1);
    await commands.create(command('00000000-0000-4000-8000-000000000002'));
    await commands.create(command('00000000-0000-4000-8000-000000000003'));
    await commands.markAcked('00000000-0000-4000-8000-000000000003');

    expect((await service.listStatus())[0]).toMatchObject({
      pendingCommands: 2,
    });
  });

  it('marks every device offline', async () => {
    await service.markOnline('d1', '1.0.0');
    await service.markOnline('d2', '1.0.0');
    await service.markAllOffline();
    const statuses = await service.listStatus();
    expect(statuses.every((s) => !s.online)).toBe(true);
  });

  describe('getOnlyDeviceId', () => {
    it('returns the single known device even when offline', async () => {
      await service.ensureDevice('d1');
      expect(await service.getOnlyDeviceId()).toBe('d1');
      await service.markOnline('d2', '1.0.0');
      expect(await service.getOnlyDeviceId()).toBeNull();
    });
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

describe('DevicesService.onConnected (R17)', () => {
  it('runs every listener and survives a failing one', async () => {
    const service = new DevicesService(
      new InMemoryDevicesRepository(),
      new InMemoryDeviceCommandsRepository(),
    );
    const calls: string[] = [];
    service.onConnected(() => {
      throw new Error('boom');
    });
    service.onConnected((deviceId) => {
      calls.push(deviceId);
    });
    await expect(service.notifyConnected('d1')).resolves.toBeUndefined();
    expect(calls).toEqual(['d1']);
  });
});
