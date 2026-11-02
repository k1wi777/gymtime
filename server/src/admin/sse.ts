import type { SystemEvent } from '../common/events/system-event.js';

/** Serializes one event as an SSE frame (`event:`, `data:` and a blank line). */
export function formatSseEvent(event: SystemEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
