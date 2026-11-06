import { Injectable, Logger } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import type {
  SystemEvent,
  SystemEventMap,
  SystemEventType,
} from './system-event.js';

/**
 * In-process bus for live system events. No history: a late subscriber only
 * sees what happens from then on. `emit` never throws, so a broken subscriber
 * can never fail the code that produced the event.
 */
@Injectable()
export class SystemEventsService {
  private readonly logger = new Logger(SystemEventsService.name);
  private readonly subject = new Subject<SystemEvent>();

  get events(): Observable<SystemEvent> {
    return this.subject.asObservable();
  }

  emit<K extends SystemEventType>(
    type: K,
    data: SystemEventMap[K],
    at: Date = new Date(),
  ): void {
    try {
      this.subject.next({ type, at: at.toISOString(), data } as SystemEvent);
    } catch (error) {
      this.logger.error({
        event: 'system_event_failed',
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
