import { describe, expect, it, vi } from 'vitest';
import { AlarmScheduler } from '../../alarm/alarm-scheduler.js';
import { bogota, buildAlarmFixture } from '../../alarm/testing.js';
import { EnrollmentExpirer } from '../../fingerprints/enrollment-expirer.js';
import { defaultFingerprintsConfig } from '../../fingerprints/fingerprints.config.js';
import { buildEnrollmentFixture } from '../../fingerprints/testing.js';
import { SyncScheduler } from '../../sync/sync-scheduler.js';
import { buildSyncFixture } from '../../sync/testing.js';
import { InMemoryLeaderLock, LeaderRegistry } from './leader-lock.js';

function twoInstances() {
  const registry = new LeaderRegistry();
  return {
    a: new InMemoryLeaderLock(registry),
    b: new InMemoryLeaderLock(registry),
  };
}

describe('InMemoryLeaderLock (R15)', () => {
  it('only one instance leads and the lock passes on when it is released', () => {
    const { a, b } = twoInstances();
    expect(a.start()).toBe(true);
    expect(b.start()).toBe(false);
    expect([a.isLeader(), b.isLeader()]).toEqual([true, false]);
    expect(b.retry()).toBe(false);
    a.stop();
    expect(a.isLeader()).toBe(false);
    expect(b.retry()).toBe(true);
    expect(b.isLeader()).toBe(true);
  });
});

describe('schedulers only run on the leader (R15)', () => {
  it('EnrollmentExpirer: the follower does not sweep, the new leader does', async () => {
    const { a, b } = twoInstances();
    a.start();
    b.start();
    const fx = buildEnrollmentFixture();
    const spy = vi.spyOn(fx.service, 'expireOverdue');
    const config = { ...defaultFingerprintsConfig, expirySweepMs: 20 };
    const leader = new EnrollmentExpirer(fx.service, config, a);
    const follower = new EnrollmentExpirer(fx.service, config, b);
    await leader.sweep();
    await follower.sweep();
    expect(spy).toHaveBeenCalledTimes(1);
    a.stop();
    b.retry();
    await follower.sweep();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('AlarmScheduler: a single instance sends the alarm; the follower recovers on takeover', async () => {
    const { a, b } = twoInstances();
    a.start();
    b.start();
    const f = buildAlarmFixture(bogota('09:00'));
    await f.markOnline();
    await f.weekly('A', '10:00', '11:00');
    const make = (lock: InMemoryLeaderLock) =>
      new AlarmScheduler(f.instances, f.service, f.clock, f.config, lock);
    const first = make(a);
    const second = make(b);
    const tickSpy = vi.spyOn(f.service, 'tick');
    await Promise.all([first.tick(), second.tick()]);
    f.setNow(new Date(bogota('11:00').getTime() + 400));
    await Promise.all([first.tick(), second.tick()]);
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(1));
    expect(tickSpy).toHaveBeenCalledTimes(1); // only the leader evaluated time

    // The leader dies; the other takes over and starts with a recovery pass.
    a.stop();
    b.retry();
    const recover = vi.spyOn(f.service, 'recover');
    await second.tick();
    expect(recover).toHaveBeenCalledTimes(1);
    await second.tick();
    expect(tickSpy).toHaveBeenCalledTimes(2);
  });

  it('SyncScheduler: the follower triggers nothing and does not consume the interval', async () => {
    const { a, b } = twoInstances();
    a.start();
    b.start();
    const f = buildSyncFixture();
    const sync = { requestSync: vi.fn().mockResolvedValue(null) };
    const follower = new SyncScheduler(
      f.instances,
      sync as never,
      f.clock,
      f.config,
      b,
    );
    await follower.tick();
    expect(sync.requestSync).not.toHaveBeenCalled();
  });
});
