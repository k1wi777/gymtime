import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';

describe('DevicesController', () => {
  it('returns the status of every device', async () => {
    const service = new DevicesService(new InMemoryDevicesRepository());
    await service.markOnline('d1', '2.0.0', new Date('2026-01-01T00:00:00Z'));
    expect(await new DevicesController(service).status()).toEqual([
      {
        deviceId: 'd1',
        online: true,
        lastConnectedAt: '2026-01-01T00:00:00.000Z',
        firmwareVersion: '2.0.0',
      },
    ]);
  });
});
