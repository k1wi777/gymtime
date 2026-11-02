import { Sender } from './sender.js';

describe('Sender', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const transmit = vi.fn();
    const onGiveUp = vi.fn();
    return { transmit, onGiveUp, sender: new Sender({ transmit, onGiveUp }) };
  }

  it('resends the same frame every 5 s up to 3 times then gives up', () => {
    const { transmit, onGiveUp, sender } = setup();
    sender.send('id-1', 'frame');
    expect(transmit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(transmit).toHaveBeenCalledTimes(4);
    expect(transmit.mock.calls.every(([raw]) => raw === 'frame')).toBe(true);
    expect(onGiveUp).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(onGiveUp).toHaveBeenCalledWith('id-1', 'frame');
    vi.advanceTimersByTime(60_000);
    expect(transmit).toHaveBeenCalledTimes(4);
  });

  it('stops resending once confirmed', () => {
    const { transmit, sender } = setup();
    sender.send('id-1', 'frame');
    expect(sender.confirm('id-1')).toBe(true);
    expect(sender.confirm('id-1')).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(transmit).toHaveBeenCalledTimes(1);
  });

  it('clear cancels everything', () => {
    const { transmit, onGiveUp, sender } = setup();
    sender.send('id-1', 'frame');
    sender.clear();
    vi.advanceTimersByTime(60_000);
    expect(transmit).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
  });
});
