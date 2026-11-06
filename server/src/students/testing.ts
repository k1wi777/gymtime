import { systemClock, type Clock } from '../common/time/clock.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { InMemoryEventLogRepository } from '../common/audit/in-memory-event-log.repository.js';
import { DISPLAY_DEFAULTS } from '@gymtime/shared';
import type { DisplayConfig } from '../config/display.config.js';
import type { StudentsRepository } from './domain/students.repository.js';
import { InMemoryStudentsRepository } from './infrastructure/in-memory-students.repository.js';
import { StudentsService } from './students.service.js';

export const testDisplayConfig: DisplayConfig = {
  cols: DISPLAY_DEFAULTS.cols,
  rows: DISPLAY_DEFAULTS.rows,
  resultSeconds: DISPLAY_DEFAULTS.resultSeconds,
};

/** Students service on in-memory repositories; exposes the audit trail. */
export function buildStudentsService(
  repository: StudentsRepository = new InMemoryStudentsRepository(),
  eventLog: InMemoryEventLogRepository = new InMemoryEventLogRepository(),
  clock: Clock = systemClock,
) {
  const service = new StudentsService(
    repository,
    new EventLogService(eventLog),
    testDisplayConfig,
    clock,
  );
  return { service, eventLog };
}
