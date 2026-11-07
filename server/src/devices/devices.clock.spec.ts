import { EventLogService } from '../common/audit/event-log.service.js';
import { InMemoryEventLogRepository } from '../common/audit/in-memory-event-log.repository.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { defaultDevicesConfig } from './devices.config.js';
import { DevicesService } from './devices.service.js';
import { InMemoryDeviceCommandsRepository } from './infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';

const T = new Date('2026-11-02T15:00:00Z');
const seconds = Math.floor(T.getTime() / 1000);

function build() {
  const log = new InMemoryEventLogRepository();
  const events = new SystemEventsService();
  const seen: unknown[] = [];
  events.events.subscribe((e) => {
    if (e.type === 'device.clock_skew') seen.push(e.data);
  });
  const service = new DevicesService(
    new InMemoryDevicesRepository(),
    new InMemoryDeviceCommandsRepository(),
    defaultDevicesConfig,
    new EventLogService(log),
    events,
  );
  return { service, seen, log };
}

describe('DevicesService hello extras (R1, R3)', () => {
  it('treats a hello without extras as a v0 reader: no capabilities, no measure', async () => {
    const { service, seen } = build();
    await service.markOnline('d1', '1.0.0', T);
    expect(await service.listClockStatus()).toEqual([
      {
        deviceId: 'd1',
        capabilities: [],
        clockOffsetSec: null,
        clockCheckedAt: null,
        clockWarning: false,
        clockThresholdSec: 30,
      },
    ]);
    expect(service.helloInfo('d1')).toMatchObject({
      capabilities: [],
      queued: 0,
    });
    expect(seen).toEqual([]);
  });

  it('stores what the hello declares and forgets it at the next hello', async () => {
    const { service } = build();
    await service.markOnline('d1', '1.1.0', T, {
      capabilities: ['offline'],
      queued: 37,
    });
    expect(service.helloInfo('d1')).toMatchObject({
      capabilities: ['offline'],
      queued: 37,
    });
    await service.markOnline('d1', '1.1.0', T);
    expect(service.helloInfo('d1')?.capabilities).toEqual([]);
    expect((await service.listClockStatus())[0]?.capabilities).toEqual([]);
  });

  it('warns beyond 30 s but not at 29 or 30 s', async () => {
    const { service, seen } = build();
    await service.markOnline('d1', 'fw', T, { deviceTime: seconds + 29 });
    await service.markOnline('d1', 'fw', T, { deviceTime: seconds - 30 });
    expect(seen).toEqual([]);
    expect((await service.listClockStatus())[0]).toMatchObject({
      clockOffsetSec: -30,
      clockWarning: false,
    });

    await service.markOnline('d1', 'fw', T, { deviceTime: seconds + 31 });
    expect(seen).toEqual([
      { deviceId: 'd1', offsetSec: 31, thresholdSec: 30, warning: true },
    ]);
    expect((await service.listClockStatus())[0]).toMatchObject({
      clockOffsetSec: 31,
      clockWarning: true,
      clockCheckedAt: T.toISOString(),
    });
  });

  it('publishes and audits only when crossing the threshold, in both directions', async () => {
    const { service, seen, log } = build();
    await service.markOnline('d1', 'fw', T, { deviceTime: seconds + 120 });
    await service.markOnline('d1', 'fw', T, { deviceTime: seconds + 90 });
    expect(seen).toHaveLength(1);
    await service.markOnline('d1', 'fw', T, { deviceTime: seconds + 1 });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ warning: false, offsetSec: 1 });
    expect(
      log.entries.filter((e) => e.type === 'device.clock_skew'),
    ).toHaveLength(2);
  });

  it('never changes the time it received: it only measures', async () => {
    const { service } = build();
    await service.markOnline('d1', 'fw', T, { deviceTime: seconds + 500 });
    expect((await service.listClockStatus())[0]?.clockOffsetSec).toBe(500);
  });
});
