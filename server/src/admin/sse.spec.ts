import { formatSseEvent } from './sse.js';

describe('formatSseEvent', () => {
  it('writes the event name, the JSON payload and a blank line', () => {
    const frame = formatSseEvent({
      type: 'scan',
      at: '2026-11-02T15:00:00.000Z',
      data: { slot: 5, result: 'entry' },
    });
    expect(frame).toBe(
      'event: scan\ndata: {"type":"scan","at":"2026-11-02T15:00:00.000Z","data":{"slot":5,"result":"entry"}}\n\n',
    );
  });
});
