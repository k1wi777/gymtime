import { AlarmSimulator } from './alarm-simulator.js';

describe('AlarmSimulator', () => {
  it('describes a continuous alarm and keeps its reason', () => {
    const alarm = new AlarmSimulator();

    expect(
      alarm.onSet({ on: true, durationSec: null, reason: 'PENDING_EXIT' }),
    ).toBe('ALARM ON (PENDING_EXIT) continua');
    expect(alarm.current).toEqual({
      on: true,
      reason: 'PENDING_EXIT',
      durationSec: null,
    });
  });

  it('describes a timed beep in seconds', () => {
    const alarm = new AlarmSimulator();
    expect(alarm.onSet({ on: true, durationSec: 5, reason: 'END_BEEP' })).toBe(
      'ALARM ON (END_BEEP) 5 s',
    );
  });

  it('describes the off order with its reason', () => {
    const alarm = new AlarmSimulator();
    alarm.onSet({ on: true, durationSec: null, reason: 'MANUAL' });

    expect(
      alarm.onSet({ on: false, durationSec: null, reason: 'CLEARED' }),
    ).toBe('ALARM OFF (CLEARED)');
    expect(alarm.current).toMatchObject({ on: false, reason: 'CLEARED' });
  });

  it('reports the automatic off with the reason that was sounding', () => {
    const alarm = new AlarmSimulator();
    alarm.onSet({ on: true, durationSec: 5, reason: 'END_BEEP' });

    expect(alarm.autoOff()).toContain('alarm auto-off');
    expect(alarm.autoOff()).toContain('END_BEEP');
    expect(alarm.current).toMatchObject({ on: false, durationSec: null });
  });
});
