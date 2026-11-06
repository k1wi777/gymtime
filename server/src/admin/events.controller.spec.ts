import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { AuthService } from '../auth/auth.service.js';
import { buildAuthFixture, minutes } from '../auth/testing.js';
import type { AuthContext } from '../common/auth/auth-context.js';
import {
  EventsController,
  SSE_KEEPALIVE_MS,
  SSE_MAX_BUFFERED_BYTES,
} from './events.controller.js';

// Only the system credential reaches the plain streams: no session lookup.
const systemAuth = {} as AuthService;

function fakeResponse(writeResult = true) {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  const response = {
    writableEnded: false,
    writableLength: 0,
    status: vi.fn(),
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      chunks.push(chunk);
      return writeResult;
    }),
    end: vi.fn(() => {
      response.writableEnded = true;
    }),
  };
  return { res: response as unknown as Response, headers, chunks, response };
}

function fakeRequest() {
  return new EventEmitter() as unknown as Request;
}

describe('EventsController (R11, R12)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sets the SSE headers and streams every event', () => {
    const events = new SystemEventsService();
    const controller = new EventsController(events, systemAuth);
    const { res, headers, chunks } = fakeResponse();

    controller.stream(fakeRequest(), res);
    events.emit('scan', { deviceId: 'd1', slot: 5, result: 'entry' });

    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(headers['Cache-Control']).toBe('no-cache, no-transform');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('event: scan');
    expect(chunks[0]).toContain('"slot":5');
  });

  it('sends a keepalive every 15 seconds', () => {
    const events = new SystemEventsService();
    const controller = new EventsController(events, systemAuth);
    const { res, chunks } = fakeResponse();

    controller.stream(fakeRequest(), res);
    vi.advanceTimersByTime(SSE_KEEPALIVE_MS);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('event: keepalive');
  });

  it('unsubscribes and ends the response when the client closes', () => {
    const events = new SystemEventsService();
    const controller = new EventsController(events, systemAuth);
    const { res, chunks, response } = fakeResponse();
    const req = fakeRequest();

    controller.stream(req, res);
    req.emit('close');
    events.emit('alarm', { on: true });

    expect(response.end).toHaveBeenCalledTimes(1);
    expect(chunks).toHaveLength(0);
  });

  it('drops a slow client instead of buffering forever', () => {
    const events = new SystemEventsService();
    const controller = new EventsController(events, systemAuth);
    const { res, response } = fakeResponse(false);
    response.writableLength = SSE_MAX_BUFFERED_BYTES + 1;

    controller.stream(fakeRequest(), res);
    events.emit('alarm', { on: true });
    events.emit('alarm', { on: false });

    expect(response.writableLength).toBeGreaterThan(SSE_MAX_BUFFERED_BYTES);
    expect(response.write).toHaveBeenCalledTimes(1);
    expect(response.end).toHaveBeenCalledTimes(1);
  });
});

describe('EventsController with a session cookie (R13, R20)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function open() {
    const fixture = buildAuthFixture();
    await fixture.createUser('ana');
    const { token } = await fixture.login('ana');
    const session = (await fixture.service.authenticate(token))!;
    const caller: AuthContext = {
      kind: 'session',
      role: 'asistente',
      sessionId: session.sessionId,
      account: session.account,
    };
    const events = new SystemEventsService();
    const controller = new EventsController(events, fixture.service);
    const { res, chunks, response } = fakeResponse();
    controller.stream(fakeRequest(), res, caller);
    /** Moves the fake timers and the auth clock together. */
    const advance = async (ms: number) => {
      fixture.clock.advance(ms);
      await vi.advanceTimersByTimeAsync(ms);
    };
    return { fixture, session, token, events, chunks, response, advance };
  }

  it('survives 10 minutes without events, with a heartbeat every 15 seconds', async () => {
    const { chunks, response, advance, fixture, token } = await open();
    // The panel keeps the session alive with the user's activity.
    for (let i = 0; i < 20; i += 1) {
      await advance(30_000);
      expect(await fixture.service.authenticate(token)).not.toBeNull();
    }
    expect(chunks).toHaveLength(40);
    expect(chunks.every((chunk) => chunk.includes('event: keepalive'))).toBe(
      true,
    );
    expect(response.end).not.toHaveBeenCalled();
  });

  it('ends at the next heartbeat after the session is revoked', async () => {
    const { fixture, session, chunks, response, advance } = await open();
    await advance(15_000);
    expect(chunks).toHaveLength(1);
    await fixture.sessions.revoke(session.sessionId, fixture.clock.now());
    await advance(14_000);
    expect(response.end).not.toHaveBeenCalled();
    await advance(1_000);
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(chunks).toHaveLength(1);
    await advance(60_000);
    expect(chunks).toHaveLength(1);
  });

  it('ends when the account is deactivated', async () => {
    const { fixture, session, response, advance } = await open();
    await fixture.users.update(session.account.id, { active: false });
    await advance(15_000);
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('does not renew the idle timer: an abandoned screen expires at 30 minutes', async () => {
    const { response, advance, chunks } = await open();
    await advance(minutes(29));
    expect(response.end).not.toHaveBeenCalled();
    await advance(minutes(1));
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('keeps streaming events to a live session', async () => {
    const { events, chunks } = await open();
    events.emit('alarm', { on: true });
    expect(chunks[0]).toContain('event: alarm');
  });
});
