import { entryWindow } from './entry-window.js';

const instance = {
  startsAt: new Date('2026-11-02T15:00:00Z'),
  endsAt: new Date('2026-11-02T16:00:00Z'),
};
const defaults = { openMinutes: 10, closeMinutes: 5 };

describe('entryWindow (R7)', () => {
  it('uses the defaults when the schedule defines no margins', () => {
    const w = entryWindow(
      instance,
      { entryOpenMinutes: null, entryCloseMinutes: null },
      defaults,
    );
    expect(w.opensAt.toISOString()).toBe('2026-11-02T14:50:00.000Z');
    expect(w.closesAt.toISOString()).toBe('2026-11-02T15:55:00.000Z');
  });

  it('prefers the schedule margins, including an explicit zero', () => {
    const w = entryWindow(
      instance,
      { entryOpenMinutes: 0, entryCloseMinutes: 20 },
      defaults,
    );
    expect(w.opensAt).toEqual(instance.startsAt);
    expect(w.closesAt.toISOString()).toBe('2026-11-02T15:40:00.000Z');
  });

  it('reflects a configuration change without any stored value', () => {
    const schedule = { entryOpenMinutes: null, entryCloseMinutes: null };
    const a = entryWindow(instance, schedule, defaults);
    const b = entryWindow(instance, schedule, { ...defaults, openMinutes: 30 });
    expect(b.opensAt.getTime()).toBeLessThan(a.opensAt.getTime());
  });
});
