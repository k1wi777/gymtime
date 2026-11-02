import { SyncScheduler } from './sync-scheduler.js';
import { SyncService } from './sync.service.js';
import { buildSyncFixture } from './testing.js';

const bogota = (hhmm: string, date = '2026-11-02') =>
  new Date(`${date}T${hhmm}:00-05:00`);

function build() {
  const f = buildSyncFixture();
  const requestSync = vi.fn().mockResolvedValue(null);
  const sync = { requestSync } as unknown as SyncService;
  const scheduler = new SyncScheduler(f.instances, sync, f.clock, f.config);
  return { f, requestSync, scheduler };
}

describe('SyncScheduler (R5, R17)', () => {
  it('fires 15 minutes before the start and at the end, once each', async () => {
    const { f, requestSync, scheduler } = build();
    await f.weekly('A', '10:00', '11:00');
    const tickAt = async (hhmm: string) => {
      f.setNow(bogota(hhmm));
      await scheduler.tick();
    };
    await tickAt('09:00'); // lastTick = 09:00 (constructed at 09:00)
    await tickAt('09:44'); // before 09:45
    expect(requestSync).not.toHaveBeenCalled();
    await tickAt('09:46');
    expect(requestSync).toHaveBeenCalledTimes(1);
    expect(requestSync).toHaveBeenLastCalledWith('before_start');
    await tickAt('09:50');
    await tickAt('10:59');
    expect(requestSync).toHaveBeenCalledTimes(1);
    await tickAt('11:00');
    expect(requestSync).toHaveBeenCalledTimes(2);
    expect(requestSync).toHaveBeenLastCalledWith('after_end');
    await tickAt('11:30');
    expect(requestSync).toHaveBeenCalledTimes(2);
  });

  it('issues a single sync when several edges fall in the same interval', async () => {
    const { f, requestSync, scheduler } = build();
    await f.weekly('A', '10:00', '10:30');
    await f.weekly('B', '10:00', '10:45');
    f.setNow(bogota('09:50'));
    await scheduler.tick();
    expect(requestSync).toHaveBeenCalledTimes(1);
  });

  it('walks a day with two back-to-back schedules: before-start and after-end triggers', async () => {
    const { f, requestSync, scheduler } = build();
    await f.weekly('A', '10:00', '11:00');
    await f.weekly('B', '11:00', '12:00');
    const reasons: string[] = [];
    for (let minute = 9 * 60; minute <= 12 * 60 + 5; minute++) {
      const hh = String(Math.floor(minute / 60)).padStart(2, '0');
      const mm = String(minute % 60).padStart(2, '0');
      f.setNow(bogota(`${hh}:${mm}`));
      const before = requestSync.mock.calls.length;
      await scheduler.tick();
      if (requestSync.mock.calls.length > before) {
        reasons.push(`${hh}:${mm} ${requestSync.mock.calls.at(-1)?.[0]}`);
      }
    }
    expect(reasons).toEqual([
      '09:45 before_start',
      '10:45 before_start', // B's lead; A is still in progress
      '11:00 after_end', // A ended, B in progress
      '12:00 after_end',
    ]);
  });

  it('generates the occurrences of the next days on each tick (R5)', async () => {
    const { f, scheduler } = build();
    await f.weekly('Mondays', '10:00', '11:00');
    f.setNow(bogota('08:00', '2026-11-09'));
    await scheduler.tick();
    const next = await f.instancesRepo.findInRange(
      bogota('00:00', '2026-11-09'),
      bogota('23:59', '2026-11-09'),
    );
    expect(next).toHaveLength(1);
  });

  it('survives a failing tick and examines the same interval again', async () => {
    const { f, requestSync, scheduler } = build();
    await f.weekly('A', '10:00', '11:00');
    vi.spyOn(f.instances, 'ensureHorizon').mockRejectedValueOnce(
      new Error('db'),
    );
    f.setNow(bogota('09:50'));
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(requestSync).not.toHaveBeenCalled();
    await scheduler.tick();
    expect(requestSync).toHaveBeenCalledWith('before_start');
  });

  it('ticks periodically after init and stops on destroy', async () => {
    const { f, scheduler } = build();
    const spy = vi.spyOn(scheduler, 'tick');
    const fast = new SyncScheduler(
      f.instances,
      { requestSync: vi.fn() } as never,
      f.clock,
      {
        ...f.config,
        tickMs: 10,
      },
    );
    const tick = vi.spyOn(fast, 'tick');
    fast.onModuleInit();
    await vi.waitFor(() =>
      expect(tick.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    fast.onModuleDestroy();
    const calls = tick.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(tick.mock.calls.length).toBe(calls);
    expect(spy).not.toHaveBeenCalled();
  });
});
