import type { ConfigService } from '@nestjs/config';
import { EventLogService } from '../common/audit/event-log.service.js';
import { InMemoryEventLogRepository } from '../common/audit/in-memory-event-log.repository.js';
import { systemClock } from '../common/time/clock.js';
import type { Env } from '../config/env.schema.js';
import {
  CLOSE_TOKEN_CHANGED,
  ConnectionRegistry,
  type DeviceConnection,
} from './connection-registry.js';
import {
  DeviceAlreadyRegisteredError,
  DeviceTokensService,
  UnknownDeviceError,
  hashToken,
} from './device-tokens.service.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';

const SHARED = 'shared-device-token-123';

function setup(shared: string | null = SHARED) {
  const repository = new InMemoryDevicesRepository();
  const registry = new ConnectionRegistry();
  const events = new InMemoryEventLogRepository();
  const config = { get: () => shared ?? undefined } as unknown as ConfigService<
    Env,
    true
  >;
  const service = new DeviceTokensService(
    repository,
    registry,
    new EventLogService(events),
    config,
    systemClock,
  );
  const connection = (): DeviceConnection & { closed: unknown[] } => {
    const closed: unknown[] = [];
    return { send: () => {}, close: (...args) => closed.push(args), closed };
  };
  return { service, repository, registry, events, connection };
}

describe('DeviceTokensService', () => {
  it('registers a device with a 256-bit token and stores only its hash', async () => {
    const { service, repository } = setup();
    const { token } = await service.register('esp32-01');
    expect(token).toMatch(/^gt_dev_[A-Za-z0-9_-]{43}$/);
    const device = await repository.findById('esp32-01');
    expect(device?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(device)).not.toContain(token);
    expect(await service.verify('esp32-01', token)).toBe('own');
    expect(await service.statusOf('esp32-01')).toBe('own');
  });

  it('refuses to register twice: rotate instead', async () => {
    const { service } = setup();
    await service.register('d1');
    await expect(service.register('d1')).rejects.toBeInstanceOf(
      DeviceAlreadyRegisteredError,
    );
  });

  it('accepts the shared token only while the device has no own token and was never revoked', async () => {
    const { service } = setup();
    expect(await service.verify('d1', SHARED)).toBe('legacy');
    expect(await service.statusOf('d1')).toBe('legacy');
    await service.register('d1');
    expect(await service.verify('d1', SHARED)).toBe(false);
    expect(await service.verify('d2', SHARED)).toBe('legacy');
  });

  it('a revoked device accepts nothing, not even the shared token', async () => {
    const { service, repository } = setup();
    const { token } = await service.register('d1');
    await service.revoke('d1');
    expect(await service.verify('d1', token)).toBe(false);
    expect(await service.verify('d1', SHARED)).toBe(false);
    expect(await service.statusOf('d1')).toBe('revoked');
    expect((await repository.findById('d1'))?.tokenHash).toBeNull();
  });

  it('rotating kills the old token at once and closes the open connection', async () => {
    const { service, registry, connection } = setup();
    const { token: oldToken } = await service.register('d1');
    const live = connection();
    registry.register('d1', live);
    const { token: newToken } = await service.rotate('d1');
    expect(newToken).not.toBe(oldToken);
    expect(live.closed).toEqual([[CLOSE_TOKEN_CHANGED, 'token changed']]);
    expect(await service.verify('d1', oldToken)).toBe(false);
    expect(await service.verify('d1', newToken)).toBe('own');
  });

  it('revoking closes the open connection and a later rotation re-enables the device', async () => {
    const { service, registry, connection } = setup();
    await service.register('d1');
    const live = connection();
    registry.register('d1', live);
    await service.revoke('d1');
    expect(live.closed).toHaveLength(1);
    const { token } = await service.rotate('d1');
    expect(await service.verify('d1', token)).toBe('own');
  });

  it('only own tokens when DEVICE_TOKEN is not defined', async () => {
    const { service } = setup(null);
    expect(await service.verify('d1', SHARED)).toBe(false);
    const { token } = await service.register('d1');
    expect(await service.verify('d1', token)).toBe('own');
  });

  it('rotate and revoke of an unknown device fail', async () => {
    const { service } = setup();
    await expect(service.rotate('nope')).rejects.toBeInstanceOf(
      UnknownDeviceError,
    );
    await expect(service.revoke('nope')).rejects.toBeInstanceOf(
      UnknownDeviceError,
    );
  });

  it('audits every action without the token or its hash', async () => {
    const { service, events } = setup();
    const { token } = await service.register('d1');
    const rotated = await service.rotate('d1');
    await service.revoke('d1');
    const trail = await events.search({ limit: 100 });
    expect(trail.map((e) => e.type).sort()).toEqual([
      'device.token_registered',
      'device.token_revoked',
      'device.token_rotated',
    ]);
    const text = JSON.stringify(trail);
    expect(text).not.toContain(token);
    expect(text).not.toContain(rotated.token);
    expect(text).not.toContain(hashToken(token));
    expect(trail.every((e) => e.detail?.['deviceId'] === 'd1')).toBe(true);
  });
});
