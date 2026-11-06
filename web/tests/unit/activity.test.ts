import type { Mock } from 'vitest';
import { trackActivity } from '@/lib/activity';

describe('activity renewal (R12)', () => {
  let touch: Mock<() => Promise<void>>;
  let stop: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    touch = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    stop = trackActivity({ touch, now: () => Date.now() });
  });
  afterEach(() => stop());

  const click = () => window.dispatchEvent(new Event('pointerdown'));
  const key = () => window.dispatchEvent(new Event('keydown'));

  it('does nothing without activity', () => {
    vi.advanceTimersByTime(10 * 60_000);
    expect(touch).not.toHaveBeenCalled();
  });

  it('renews at once on the first activity', () => {
    click();
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it('calls at most once per minute however much the user clicks', () => {
    click();
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(1_000);
      click();
      key();
    }
    expect(touch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(40_000);
    expect(touch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(touch).toHaveBeenCalledTimes(2);
  });

  it('stops listening once cleaned up', () => {
    stop();
    click();
    expect(touch).not.toHaveBeenCalled();
  });

  it('swallows a failing renewal', async () => {
    touch.mockRejectedValue(new Error('offline'));
    expect(() => click()).not.toThrow();
    await Promise.resolve();
  });
});
