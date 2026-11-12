import { DISPLAY_DEFAULTS } from '@gymtime/shared';
import { DISPLAY_CONFIG } from '../../config/display.config.js';
import { EVENT_LOG_REPOSITORY } from './event-log.repository.js';
import { EventLogService } from './event-log.service.js';
import { InMemoryEventLogRepository } from './in-memory-event-log.repository.js';

/** Providers a Nest testing module needs for services that audit or use the display. */
export const auditTestProviders = [
  { provide: EVENT_LOG_REPOSITORY, useClass: InMemoryEventLogRepository },
  EventLogService,
  {
    provide: DISPLAY_CONFIG,
    useValue: {
      titleMax: DISPLAY_DEFAULTS.titleMax,
      subtitleMax: DISPLAY_DEFAULTS.subtitleMax,
      subtitleLines: DISPLAY_DEFAULTS.subtitleLines,
      nameMax: DISPLAY_DEFAULTS.nameMax,
      resultSeconds: DISPLAY_DEFAULTS.resultSeconds,
    },
  },
];
