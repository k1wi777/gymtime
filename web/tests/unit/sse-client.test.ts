import {
  SseClient,
  type ConnectionState,
  type ProbeResult,
} from '@/live/sse-client';
import { FakeEventSource } from './helpers';

function setup(probeResult: ProbeResult = 'ok') {
  FakeEventSource.reset();
  const probe = vi.fn().mockResolvedValue(probeResult);
  const client = new SseClient({
    url: 'http://api.test/events',
    open: (url) => new FakeEventSource(url, { withCredentials: true }) as never,
    probe,
    random: () => 1,
  });
  const states: ConnectionState[] = [];
  const resync = vi.fn();
  const unauthorized = vi.fn();
  const events: string[] = [];
  client.onState((s) => states.push(s));
  client.onResync(resync);
  client.onUnauthorized(unauthorized);
  client.onEvent((e) => events.push(e.type));
  return { client, probe, states, resync, unauthorized, events };
}

describe('SseClient (R11)', () => {
  beforeEach(() => vi.useFakeTimers());

  it('opens with the session cookie and reports connected on open', () => {
    const { client, states, resync } = setup();
    client.start();
    const source = FakeEventSource.last();
    expect(source.url).toBe('http://api.test/events');
    expect(source.init?.withCredentials).toBe(true);
    source.open();
    expect(client.state).toBe('connected');
    expect(states).toEqual(['connected']);
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it('delivers typed events, ignores keepalives and bad frames', () => {
    const { client, events } = setup();
    client.start();
    const source = FakeEventSource.last();
    source.open();
    source.emit('attendance', { change: 'entry' });
    source.emit('keepalive');
    source.emit('alarm', { on: true });
    source.emit('scan', {}); // valid
    expect(events).toEqual(['attendance', 'alarm', 'scan']);
  });

  it('shows reconnecting while the browser retries, then resyncs on open', () => {
    const { client, resync } = setup();
    client.start();
    const source = FakeEventSource.last();
    source.open();
    source.hiccup();
    expect(client.state).toBe('reconnecting');
    source.open();
    expect(client.state).toBe('connected');
    expect(resync).toHaveBeenCalledTimes(2);
  });

  it('reads «desconectado» after repeated failures and recovers by itself', async () => {
    const { client, probe, resync } = setup('error');
    client.start();
    FakeEventSource.last().fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.state).toBe('reconnecting');
    // Exponential backoff: 1 s, 2 s, then 4 s (jitter fixed at its maximum).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.last().fail();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeEventSource.instances).toHaveLength(3);
    FakeEventSource.last().fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.state).toBe('disconnected');
    expect(probe).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(FakeEventSource.instances).toHaveLength(4);
    FakeEventSource.last().open();
    expect(client.state).toBe('connected');
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it('sends the user to the login when the probe says the session is over', async () => {
    const { client, unauthorized } = setup('unauthorized');
    client.start();
    FakeEventSource.last().fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(client.state).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('restarts a stream that stays silent for 45 seconds', async () => {
    const { client, resync } = setup();
    client.start();
    FakeEventSource.last().open();
    await vi.advanceTimersByTimeAsync(44_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.last().emit('keepalive'); // a heartbeat resets the watchdog
    await vi.advanceTimersByTimeAsync(44_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    expect(client.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.last().open();
    expect(resync).toHaveBeenCalledTimes(2);
  });

  it('stop() closes everything and reads disconnected', async () => {
    const { client } = setup();
    client.start();
    const source = FakeEventSource.last();
    source.open();
    client.stop();
    expect(source.closed).toBe(true);
    expect(client.state).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
