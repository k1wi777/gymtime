import { formatSseEvent } from './sse.js';
import { scanData } from '../common/events/testing.js';

describe('formatSseEvent', () => {
  it('writes the event name, the JSON payload and a blank line', () => {
    const frame = formatSseEvent({
      type: 'scan',
      at: '2026-11-02T15:00:00.000Z',
      data: scanData({ slot: 5, result: 'entry' }),
    });
    expect(frame).toBe(
      'event: scan\ndata: {"type":"scan","at":"2026-11-02T15:00:00.000Z","data":{"deviceId":"d1","slot":5,"result":"entry","studentId":null,"studentName":null,"reason":null}}\n\n',
    );
  });
});
