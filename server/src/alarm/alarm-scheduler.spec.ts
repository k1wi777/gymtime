import { AlarmScheduler } from './alarm-scheduler.js';
import { AlarmService } from './alarm.service.js';
import { bogota, buildAlarmFixture } from './testing.js';

function build(start = bogota('09:00')) {
  const f = buildAlarmFixture(start);
  const scheduler = new AlarmScheduler(
    f.instances,
    f.service,
    f.clock,
    f.config,
  );
  return { f, scheduler };
}

async function schedule(f: ReturnType<typeof buildAlarmFixture>) {
  await f.weekly('A', '10:00', '11:00');
  const [instance] = await f.instancesOf();
  return instance;
}

describe('AlarmScheduler (R1, R11)', () => {
  it('sees the end of the occurrence within ±1 s and beeps', async () => {
    const { f, scheduler } = build();
    await f.markOnline();
    await schedule(f);
    await scheduler.tick();

    f.setNow(new Date(bogota('11:00').getTime() + 400));
    await scheduler.tick();

    await vi.waitFor(() =>
      expect(f.alarms()).toEqual([
        { on: true, durationSec: 5, reason: 'END_BEEP' },
      ]),
    );
    expect((await f.service.status()).reason).toBe('END_BEEP');
  });

  it('recovers on the first pass and does not resend the open alarm', async () => {
    const { f } = build();
    await f.markOnline();
    const instance = await schedule(f);
    await f.openSession(instance.id);
    f.setNow(bogota('11:00'));
    await f.service.onInstanceEnded(instance, f.clock.now());
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(1));
    const sent = f.link.sent.length;

    const restartedService = new AlarmService(
      f.events,
      f.attendance,
      f.instances,
      f.devices,
      f.link.sender,
      f.systemEvents,
      f.clock,
      f.config,
    );
    const restarted = new AlarmScheduler(
      f.instances,
      restartedService,
      f.clock,
      f.config,
    );
    f.setNow(bogota('11:05'));
    await restarted.tick();
    expect((await restartedService.status()).on).toBe(true);

    f.setNow(bogota('11:05:30'));
    await restarted.tick();
    expect(f.link.sent).toHaveLength(sent);
  });

  it('evaluates the recovery window and alarms once for pending sessions', async () => {
    const { f, scheduler } = build();
    await f.markOnline();
    const instance = await schedule(f);
    await f.openSession(instance.id);
    f.setNow(bogota('11:05'));

    await scheduler.tick();
    f.setNow(bogota('11:05:30'));
    await scheduler.tick();

    await vi.waitFor(() =>
      expect(f.alarms()).toEqual([
        { on: true, durationSec: null, reason: 'PENDING_EXIT' },
      ]),
    );
    expect(await f.events.findOpen()).toHaveLength(1);
  });

  it('survives a failing pass and retries', async () => {
    const { f, scheduler } = build();
    await f.markOnline();
    await f.weekly('A', '10:00', '11:00');
    vi.spyOn(f.instances, 'ensureHorizon').mockRejectedValueOnce(
      new Error('db'),
    );

    await expect(scheduler.tick()).resolves.toBeUndefined();
    await scheduler.tick();

    f.setNow(new Date(bogota('11:00').getTime() + 100));
    await scheduler.tick();
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(1));
  });

  it('ticks periodically after init and stops on destroy', async () => {
    const { f } = build();
    const fast = new AlarmScheduler(f.instances, f.service, f.clock, {
      ...f.config,
      tickMs: 10,
    });
    const tick = vi.spyOn(fast, 'tick');
    fast.onModuleInit();
    await vi.waitFor(() =>
      expect(tick.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    fast.onModuleDestroy();
    const calls = tick.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(tick.mock.calls.length).toBe(calls);
  });
});
