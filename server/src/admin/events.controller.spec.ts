import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { SystemEventsService } from '../common/events/system-events.service.js';
import {
  EventsController,
  SSE_KEEPALIVE_MS,
  SSE_MAX_BUFFERED_BYTES,
} from './events.controller.js';

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
    const controller = new EventsController(events);
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
    const controller = new EventsController(events);
    const { res, chunks } = fakeResponse();

    controller.stream(fakeRequest(), res);
    vi.advanceTimersByTime(SSE_KEEPALIVE_MS);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('event: keepalive');
  });

  it('unsubscribes and ends the response when the client closes', () => {
    const events = new SystemEventsService();
    const controller = new EventsController(events);
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
    const controller = new EventsController(events);
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
