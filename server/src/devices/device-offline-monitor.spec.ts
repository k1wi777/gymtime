import { describe, expect, it } from 'vitest';
import { EventLogService } from '../common/audit/event-log.service.js';
import { InMemoryEventLogRepository } from '../common/audit/in-memory-event-log.repository.js';
import {
  InMemoryLeaderLock,
  LeaderRegistry,
} from '../common/concurrency/leader-lock.js';
import type { SystemEvent } from '../common/events/system-event.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { DeviceOfflineMonitor } from './device-offline-monitor.js';
import { defaultDevicesConfig } from './devices.config.js';
import { DevicesService } from './devices.service.js';
import { InMemoryDeviceCommandsRepository } from './infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';

const T0 = new Date('2026-11-06T15:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function setup(thresholdMinutes = 5, lock?: InMemoryLeaderLock) {
  const repo = new InMemoryDevicesRepository();
  const devices = new DevicesService(
    repo,
    new InMemoryDeviceCommandsRepository(),
    {
      ...defaultDevicesConfig,
      offlineAlertMinutes: thresholdMinutes,
    },
  );
  const log = new InMemoryEventLogRepository();
  const events = new SystemEventsService();
  const seen: SystemEvent[] = [];
  events.events.subscribe((e) => seen.push(e));
  let now = T0;
  const monitor = new DeviceOfflineMonitor(
    devices,
    new EventLogService(log),
    events,
    { now: () => now },
    lock,
  );
  monitor.onModuleInit();
  return {
    devices,
    log,
    seen,
    monitor,
    at: (date: Date) => {
      now = date;
    },
    destroy: () => monitor.onModuleDestroy(),
  };
}

describe('DeviceOfflineMonitor (R14)', () => {
  it('raises one alert per drop, after the threshold, to log, audit trail and stream', async () => {
    const f = setup(5);
    await f.devices.markOnline('d1', '1.0', T0);
    await f.devices.markOffline('d1', T0);

    f.at(minutes(4));
    expect(await f.monitor.check()).toBe(0);
    f.at(minutes(6));
    expect(await f.monitor.check()).toBe(1);
    expect(await f.monitor.check()).toBe(0); // not again for the same drop
    f.at(minutes(60));
    expect(await f.monitor.check()).toBe(0);

    expect(
      f.seen.filter((e) => e.type === 'device.offline_alert'),
    ).toMatchObject([
      { data: { deviceId: 'd1', offlineMinutes: 6, thresholdMinutes: 5 } },
    ]);
    expect(
      f.log.entries.filter((e) => e.type === 'device.offline_alert'),
    ).toHaveLength(1);
    const [status] = await f.devices.listStatus();
    expect(status).toMatchObject({
      offlineAlert: true,
      alertThresholdMinutes: 5,
      offlineSince: T0.toISOString(),
    });
    f.destroy();
  });

  it('threshold 0 disables the alert', async () => {
    const f = setup(0);
    await f.devices.markOnline('d1', '1.0', T0);
    await f.devices.markOffline('d1', T0);
    f.at(minutes(600));
    expect(await f.monitor.check()).toBe(0);
    expect((await f.devices.listStatus())[0]?.offlineAlert).toBe(false);
    f.destroy();
  });

  it('never alerts for a device that never connected', async () => {
    const f = setup(5);
    await f.devices.ensureDevice('ghost');
    await f.devices.markAllOffline(T0);
    f.at(minutes(600));
    expect(await f.monitor.check()).toBe(0);
    f.destroy();
  });

  it('reconnecting clears the alert and records the recovery; a new drop alerts again', async () => {
    const f = setup(5);
    await f.devices.markOnline('d1', '1.0', T0);
    await f.devices.markOffline('d1', T0);
    f.at(minutes(10));
    await f.monitor.check();

    await f.devices.markOnline('d1', '1.0', minutes(11));
    expect((await f.devices.listStatus())[0]).toMatchObject({
      online: true,
      offlineAlert: false,
      offlineSince: null,
    });
    expect(f.log.entries.filter((e) => e.type === 'device.recovered')).toEqual([
      expect.objectContaining({ detail: { deviceId: 'd1' } }),
    ]);

    await f.devices.markOffline('d1', minutes(12));
    f.at(minutes(20));
    expect(await f.monitor.check()).toBe(1);
    f.destroy();
  });

  it('a reconnection without alert records no recovery', async () => {
    const f = setup(5);
    await f.devices.markOnline('d1', '1.0', T0);
    await f.devices.markOffline('d1', T0);
    await f.devices.markOnline('d1', '1.0', minutes(1));
    expect(
      f.log.entries.filter((e) => e.type === 'device.recovered'),
    ).toHaveLength(0);
    f.destroy();
  });

  it('a server restart keeps the original start of the drop', async () => {
    const f = setup(5);
    await f.devices.markOnline('d1', '1.0', T0);
    await f.devices.markOffline('d1', T0);
    await f.devices.markAllOffline(minutes(3)); // boot: offlineSince is kept
    f.at(minutes(6));
    expect(await f.monitor.check()).toBe(1);
    f.destroy();
  });

  it('only the leader alerts; the follower stays silent', async () => {
    const registry = new LeaderRegistry();
    const [a, b] = [
      new InMemoryLeaderLock(registry),
      new InMemoryLeaderLock(registry),
    ];
    a.start();
    b.start();
    const f = setup(5, b);
    await f.devices.markOnline('d1', '1.0', T0);
    await f.devices.markOffline('d1', T0);
    f.at(minutes(10));
    expect(await f.monitor.check()).toBe(0);
    a.stop();
    b.retry();
    expect(await f.monitor.check()).toBe(1);
    f.destroy();
  });
});
