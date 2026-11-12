import { deviceActor, runAsActor } from '../common/audit/actor.js';
import { AlarmService } from './alarm.service.js';
import { bogota, buildAlarmFixture } from './testing.js';

async function withSchedule(
  patch: (f: ReturnType<typeof buildAlarmFixture>) => Promise<{
    instanceId: string;
  }>,
  start = bogota('09:00'),
) {
  const f = buildAlarmFixture(start);
  await f.markOnline();
  const { instanceId } = await patch(f);
  return { f, instanceId };
}

describe('AlarmService end of occurrence (R2, R3, R4)', () => {
  it('beeps briefly when the occurrence ends with nobody inside', async () => {
    const { f, instanceId } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      const [instance] = await f.instancesOf();
      return { instanceId: instance.id };
    });
    const [instance] = await f.instancesOf();

    f.setNow(bogota('11:00'));
    await f.service.onInstanceEnded(instance, f.clock.now());

    await vi.waitFor(() =>
      expect(f.alarms()).toEqual([
        { on: true, durationSec: 5, reason: 'END_BEEP' },
      ]),
    );
    expect(await f.service.status()).toMatchObject({
      on: true,
      reason: 'END_BEEP',
      instanceId,
      durationSec: 5,
    });
    expect(await f.events.findOpen()).toHaveLength(0);
  });

  it('keeps the siren on and opens the event when someone is inside', async () => {
    const { f, instanceId } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      const [instance] = await f.instancesOf();
      await f.openSession(instance.id);
      return { instanceId: instance.id };
    });
    const [instance] = await f.instancesOf();

    f.setNow(bogota('11:00'));
    await f.service.onInstanceEnded(instance, f.clock.now());

    await vi.waitFor(() =>
      expect(f.alarms()).toEqual([
        { on: true, durationSec: null, reason: 'PENDING_EXIT' },
      ]),
    );
    const open = await f.events.findOpen();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      instanceId,
      startedAt: instance.endsAt,
      endedAt: null,
      closedBy: null,
      closedSessions: 0,
    });
  });

  it('does not beep when a continuous alarm is already on', async () => {
    const { f } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      await f.weekly('B', '10:00', '11:00');
      const instances = await f.instancesOf();
      await f.openSession(instances[0].id);
      return { instanceId: instances[0].id };
    });
    const instances = await f.instancesOf();
    f.setNow(bogota('11:00'));
    await f.service.onInstanceEnded(instances[0], f.clock.now());
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(1));

    await f.service.onInstanceEnded(instances[1], f.clock.now());

    expect(f.alarms()).toHaveLength(1);
    expect(f.alarms()[0]).toMatchObject({ reason: 'PENDING_EXIT' });
  });

  it('sends one CLEARED only when the last overlapping occurrence empties', async () => {
    const { f } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      await f.weekly('B', '10:00', '11:00');
      const instances = await f.instancesOf();
      await f.openSession(instances[0].id, 's1');
      await f.openSession(instances[1].id, 's2');
      return { instanceId: instances[0].id };
    });
    const instances = await f.instancesOf();
    f.setNow(bogota('11:00'));
    await f.service.onInstanceEnded(instances[0], f.clock.now());
    await f.service.onInstanceEnded(instances[1], f.clock.now());
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(1));

    await f.service.onInstanceEmptied(instances[0].id);
    expect(f.alarms()).toHaveLength(1);

    await f.service.onInstanceEmptied(instances[1].id);
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(2));
    expect(f.alarms()[1]).toEqual({
      on: false,
      durationSec: null,
      reason: 'CLEARED',
    });
    expect(await f.events.findOpen()).toHaveLength(0);
    expect(await f.service.status()).toMatchObject({ on: false });
  });

  it('closes the event as all_exited when its last session leaves', async () => {
    const { f, instanceId } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      const [instance] = await f.instancesOf();
      await f.openSession(instance.id);
      return { instanceId: instance.id };
    });
    const [instance] = await f.instancesOf();
    f.setNow(bogota('11:00'));
    await f.service.onInstanceEnded(instance, f.clock.now());
    const [open] = await f.events.findOpen();

    f.setNow(bogota('11:10'));
    await f.service.onInstanceEmptied(instanceId);

    expect(await f.events.findOpen()).toHaveLength(0);
    await vi.waitFor(() =>
      expect(f.alarms().at(-1)).toEqual({
        on: false,
        durationSec: null,
        reason: 'CLEARED',
      }),
    );
    expect(open).toBeDefined();
  });
});

describe('AlarmService manual off (R5, R6)', () => {
  async function alarmed() {
    const { f, instanceId } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      const [instance] = await f.instancesOf();
      await f.openSession(instance.id, 's1');
      await f.openSession(instance.id, 's2');
      return { instanceId: instance.id };
    });
    const [instance] = await f.instancesOf();
    f.setNow(bogota('11:00'));
    await f.service.onInstanceEnded(instance, f.clock.now());
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(1));
    return { f, instanceId };
  }

  it('silences through the CLI, marks the sessions and stores the count', async () => {
    const { f } = await alarmed();

    const result = await f.service.off('cli');

    expect(result).toMatchObject({
      closedBy: 'cli',
      sessionsClosed: 2,
      status: { on: false },
    });
    const rows = await f.attendanceRepo.list({ status: 'no_registrada' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      exitedAt: null,
      exitSource: null,
      manualReason: 'alarm_off_cli',
    });
    const [event] = await f.events.findOpen();
    expect(event).toBeUndefined();
    await vi.waitFor(() =>
      expect(f.alarms().at(-1)).toMatchObject({
        on: false,
        reason: 'CLEARED',
      }),
    );
  });

  it('silences through the button and records the button as the closer', async () => {
    const { f } = await alarmed();

    await f.service.onButtonPressed('dev');

    expect(await f.events.findOpen()).toHaveLength(0);
    const closed = await f.attendanceRepo.list({ status: 'no_registrada' });
    expect(closed[0]?.manualReason).toBe('alarm_off_button');
    await vi.waitFor(() =>
      expect(f.alarms().at(-1)).toMatchObject({ reason: 'CLEARED' }),
    );
  });

  it('rejects a CLI off when the alarm is not on, but the button only logs', async () => {
    const f = buildAlarmFixture();
    await f.markOnline();

    await expect(f.service.off('cli')).rejects.toMatchObject({
      code: 'ALARM_NOT_ON',
    });
    await expect(f.service.onButtonPressed('dev')).resolves.toBeUndefined();
    expect(f.alarms()).toHaveLength(0);
  });
});

describe('AlarmService manual control (R7, R8, R9, R15)', () => {
  it('requires an online device for test and on', async () => {
    const f = buildAlarmFixture();
    await expect(f.service.turnOn('TEST')).rejects.toMatchObject({
      code: 'NO_DEVICE_ONLINE',
    });
    await expect(f.service.turnOn('MANUAL')).rejects.toMatchObject({
      code: 'NO_DEVICE_ONLINE',
    });
    expect((await f.service.status()).on).toBe(false);
    expect(f.alarms()).toHaveLength(0);
  });

  it('starts TEST as a short beep and MANUAL as continuous', async () => {
    const f = buildAlarmFixture();
    await f.markOnline();

    const tested = await f.service.turnOn('TEST');
    expect(tested).toMatchObject({
      on: true,
      reason: 'TEST',
      durationSec: 5,
      instanceId: null,
    });
    expect(f.alarms().at(-1)).toEqual({
      on: true,
      durationSec: 5,
      reason: 'TEST',
    });

    const manual = await f.service.turnOn('MANUAL');
    expect(manual).toMatchObject({
      on: true,
      reason: 'MANUAL',
      durationSec: null,
    });
    expect(f.alarms().at(-1)).toEqual({
      on: true,
      durationSec: null,
      reason: 'MANUAL',
    });
  });

  it('reports the open sessions of the whole gym in status', async () => {
    const { f } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      const [instance] = await f.instancesOf();
      await f.openSession(instance.id, 's1');
      await f.openSession(instance.id, 's2');
      return { instanceId: instance.id };
    });

    expect(await f.service.status()).toMatchObject({
      on: false,
      openSessions: 2,
    });
  });
});

describe('AlarmService timeout (R10)', () => {
  it('closes abandoned sessions and clears the alarm after the timeout', async () => {
    const { f, instanceId } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      const [instance] = await f.instancesOf();
      await f.openSession(instance.id);
      return { instanceId: instance.id };
    });
    const [instance] = await f.instancesOf();
    f.setNow(bogota('11:00'));
    await f.service.onInstanceEnded(instance, f.clock.now());
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(1));

    f.setNow(bogota('11:29'));
    await f.service.tick(f.clock.now());
    expect(await f.events.findOpen()).toHaveLength(1);
    expect(f.alarms()).toHaveLength(1);

    f.setNow(bogota('11:31'));
    await f.service.tick(f.clock.now());

    const rows = await f.attendanceRepo.list({
      instanceId,
      status: 'no_registrada',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      manualReason: 'timeout',
      exitedAt: null,
      exitSource: null,
    });
    expect(await f.events.findOpen()).toHaveLength(0);
    await vi.waitFor(() =>
      expect(f.alarms().at(-1)).toEqual({
        on: false,
        durationSec: null,
        reason: 'CLEARED',
      }),
    );
  });
});

describe('AlarmService recovery (R11, R12)', () => {
  const restart = (f: ReturnType<typeof buildAlarmFixture>) => f.restart();

  it('restores an open continuous alarm without a duplicate alarm.set', async () => {
    const { f } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      const [instance] = await f.instancesOf();
      await f.openSession(instance.id);
      f.setNow(bogota('11:00'));
      await f.service.onInstanceEnded(instance, f.clock.now());
      return { instanceId: instance.id };
    });
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(1));
    await vi.waitFor(() => expect(f.messages()).toHaveLength(1));
    const sent = f.link.sent.length;

    const restarted = restart(f);
    f.setNow(bogota('11:05'));
    await restarted.recover(f.clock.now());
    expect(await restarted.status()).toMatchObject({
      on: true,
      reason: 'PENDING_EXIT',
      durationSec: null,
    });
    expect(f.link.sent).toHaveLength(sent);

    await restarted.tick(bogota('11:05:30'));
    expect(f.link.sent).toHaveLength(sent);
  });

  it('creates the missing event within the recovery window and sends once', async () => {
    const { f, instanceId } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      const [instance] = await f.instancesOf();
      await f.openSession(instance.id);
      return { instanceId: instance.id };
    });
    f.setNow(bogota('11:05'));
    await f.service.recover(f.clock.now());
    f.setNow(bogota('11:05:30'));

    await f.service.tick(f.clock.now());

    await vi.waitFor(() =>
      expect(f.alarms()).toEqual([
        { on: true, durationSec: null, reason: 'PENDING_EXIT' },
      ]),
    );
    expect(await f.events.findOpen()).toHaveLength(1);
    expect(instanceId).toBeTruthy();
  });

  it('does not replay a delayed beep after a restart', async () => {
    const f = buildAlarmFixture();
    await f.markOnline();
    await f.weekly('A', '10:00', '11:00');

    f.setNow(bogota('11:05'));
    await f.service.recover(f.clock.now());
    f.setNow(bogota('11:05:30'));
    await f.service.tick(f.clock.now());

    expect(f.alarms()).toHaveLength(0);
  });

  it('resends the continuous alarm when a device connects', async () => {
    const { f } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      const [instance] = await f.instancesOf();
      await f.openSession(instance.id);
      f.setNow(bogota('11:00'));
      await f.service.onInstanceEnded(instance, f.clock.now());
      return { instanceId: instance.id };
    });
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(1));
    await vi.waitFor(() => expect(f.messages()).toHaveLength(1));

    f.service.onDeviceConnected('other-device');

    await vi.waitFor(() => expect(f.link.send).toHaveBeenCalledTimes(4));
    expect(f.alarms().at(-1)).toMatchObject({
      on: true,
      durationSec: null,
      reason: 'PENDING_EXIT',
    });
  });
});

describe('AlarmService screen message (R12, R13)', () => {
  async function pendingExit() {
    const { f, instanceId } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      const [instance] = await f.instancesOf();
      await f.openSession(instance.id);
      f.setNow(bogota('11:00'));
      await f.service.onInstanceEnded(instance, f.clock.now());
      return { instanceId: instance.id };
    });
    await vi.waitFor(() => expect(f.messages()).toHaveLength(1));
    return { f, instanceId };
  }

  it('shows "Tiempo cumplido / Registre salida" with PENDING_EXIT for the alarm lifetime', async () => {
    const { f } = await pendingExit();
    expect(f.messages()).toEqual([
      {
        title: 'Tiempo cumplido',
        subtitle: 'Registre su salida',
        tone: 'warning',
        line1: 'Tiempo cumplido',
        line2: 'Registre su salida',
        color: 'orange',
        durationSec: f.config.timeoutMinutes * 60,
      },
    ]);
    // Replaces an older unconfirmed message instead of piling up.
    const call = f.link.send.mock.calls.find(
      ([, message]) => message.type === 'display.message',
    );
    expect(call?.[2]).toEqual({ supersedesPrevious: true });
    // The alarm text is not an operator message: nothing audited.
    expect(
      f.eventLog.entries.filter((e) => !e.type.startsWith('schedule.')),
    ).toEqual([]);
  });

  it('resends it to a reconnecting device with the remaining seconds', async () => {
    const { f } = await pendingExit();
    f.setNow(bogota('11:10'));

    f.service.onDeviceConnected('dev');

    await vi.waitFor(() => expect(f.messages()).toHaveLength(2));
    expect(f.messages()[1]).toEqual({
      title: 'Tiempo cumplido',
      subtitle: 'Registre su salida',
      tone: 'warning',
      line1: 'Tiempo cumplido',
      line2: 'Registre su salida',
      color: 'orange',
      durationSec: (f.config.timeoutMinutes - 10) * 60,
    });
  });

  it('clears the screen when the alarm is silenced', async () => {
    const { f, instanceId } = await pendingExit();

    await f.service.onInstanceEmptied(instanceId);

    await vi.waitFor(() => expect(f.messages()).toHaveLength(2));
    expect(f.messages()[1]).toEqual({
      title: '',
      subtitle: '',
      tone: 'info',
      line1: '',
      line2: '',
      color: 'white',
      durationSec: 1,
    });
    const clear = f.link.send.mock.calls.filter(
      ([, message]) => message.type === 'display.message',
    )[1];
    expect(clear?.[2]).toEqual({ supersedesPrevious: true });
  });

  it('does not send a message for END_BEEP, TEST or MANUAL', async () => {
    const f = buildAlarmFixture();
    await f.markOnline();
    await f.service.turnOn('TEST');
    await f.service.turnOn('MANUAL');
    await f.service.off('cli');
    await vi.waitFor(() => expect(f.alarms().length).toBeGreaterThan(2));
    expect(f.messages()).toEqual([]);

    await f.weekly('A', '10:00', '11:00');
    const [instance] = await f.instancesOf();
    f.setNow(bogota('11:00'));
    await f.service.onInstanceEnded(instance, f.clock.now());
    await vi.waitFor(() => expect(f.alarms().at(-1)?.reason).toBe('END_BEEP'));
    expect(f.messages()).toEqual([]);
  });

  it('audits manual on/off and the button with the actor (R19)', async () => {
    const f = buildAlarmFixture();
    await f.markOnline();
    await f.service.turnOn('MANUAL');
    await f.service.off('cli');
    await f.service.turnOn('MANUAL');
    await runAsActor(deviceActor('dev'), () =>
      f.service.onButtonPressed('dev'),
    );
    expect(f.eventLog.entries.map((e) => [e.type, e.actor])).toEqual([
      ['alarm.manual_on', { type: 'system', id: null }],
      ['alarm.manual_off', { type: 'system', id: null }],
      ['alarm.manual_on', { type: 'system', id: null }],
      ['alarm.button_off', { type: 'device', id: 'dev' }],
    ]);
  });
});

describe('AlarmService events (R11, R13)', () => {
  it('emits alarm on and off with reason and closed sessions', async () => {
    const f = buildAlarmFixture();
    await f.markOnline();
    const received: { type: string; data: Record<string, unknown> }[] = [];
    f.systemEvents.events.subscribe((event) =>
      received.push({ type: event.type, data: event.data }),
    );

    await f.service.turnOn('MANUAL');
    await f.service.off('cli');

    expect(received).toEqual([
      {
        type: 'alarm',
        data: {
          on: true,
          reason: 'MANUAL',
          closedBy: null,
          sessionsClosed: 0,
        },
      },
      {
        type: 'alarm',
        data: {
          on: false,
          reason: 'CLEARED',
          closedBy: 'cli',
          sessionsClosed: 0,
        },
      },
    ]);
  });
});

describe('AlarmService beep expiry (R13, R14)', () => {
  function collect(f: ReturnType<typeof buildAlarmFixture>) {
    const received: { on: unknown; closedBy: unknown }[] = [];
    f.systemEvents.events.subscribe((event) => {
      if (event.type === 'alarm') {
        received.push({ on: event.data.on, closedBy: event.data.closedBy });
      }
    });
    return received;
  }

  it('emits alarm off once when the test beep ends, without a new order', async () => {
    const f = buildAlarmFixture(bogota('09:00'));
    await f.markOnline();
    const received = collect(f);
    await f.service.turnOn('TEST');
    await vi.waitFor(() => expect(f.alarms()).toHaveLength(1));

    f.setNow(bogota('09:00:04'));
    await f.service.tick(f.clock.now());
    expect(received).toEqual([{ on: true, closedBy: null }]);

    f.setNow(bogota('09:00:06'));
    await f.service.tick(f.clock.now());
    await f.service.tick(f.clock.now());

    expect(received).toEqual([
      { on: true, closedBy: null },
      { on: false, closedBy: null },
    ]);
    expect((await f.service.status()).on).toBe(false);
    expect(f.alarms()).toHaveLength(1);
  });

  it('also emits it when the end-of-occurrence beep ends', async () => {
    const { f } = await withSchedule(async (f) => {
      await f.weekly('A', '10:00', '11:00');
      return { instanceId: '' };
    });
    const [instance] = await f.instancesOf();
    f.setNow(bogota('11:00'));
    await f.service.onInstanceEnded(instance, f.clock.now());
    const received = collect(f);

    f.setNow(bogota('11:00:06'));
    await f.service.tick(f.clock.now());

    expect(received).toEqual([{ on: false, closedBy: null }]);
    expect(f.alarms()).toHaveLength(1);
  });

  it('emits nothing when the alarm was already off', async () => {
    const f = buildAlarmFixture(bogota('09:00'));
    await f.markOnline();
    const received = collect(f);
    f.setNow(bogota('09:10'));
    await f.service.tick(f.clock.now());
    expect(received).toEqual([]);
  });
});
