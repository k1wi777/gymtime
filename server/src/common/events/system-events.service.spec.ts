import { SystemEventsService } from './system-events.service.js';
import type { SystemEvent } from './system-event.js';
import { alarmData, scanData } from './testing.js';

describe('SystemEventsService', () => {
  it('emits the type, an ISO instant and the data', () => {
    const service = new SystemEventsService();
    const received: SystemEvent[] = [];
    service.events.subscribe((event) => received.push(event));

    service.emit('scan', scanData(), new Date('2026-11-02T15:00:00Z'));

    expect(received).toEqual([
      {
        type: 'scan',
        at: '2026-11-02T15:00:00.000Z',
        data: scanData(),
      },
    ]);
  });

  it('never throws when publishing fails', () => {
    const service = new SystemEventsService();
    const subject = (
      service as unknown as {
        subject: { next(event: SystemEvent): void };
      }
    ).subject;
    subject.next = () => {
      throw new Error('boom');
    };

    expect(() => service.emit('alarm', alarmData())).not.toThrow();
  });
});
