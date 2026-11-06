import type { Clock } from '../common/time/clock.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { InMemoryEventLogRepository } from '../common/audit/in-memory-event-log.repository.js';
import { buildStudentsService } from '../students/testing.js';
import { InstancesService } from './instances.service.js';
import { InMemoryPeriodsRepository } from './periods/in-memory-periods.repository.js';
import { InMemoryInstancesRepository } from './infrastructure/in-memory-instances.repository.js';
import { InMemorySchedulesRepository } from './infrastructure/in-memory-schedules.repository.js';
import { InMemoryStudentsRepository } from '../students/infrastructure/in-memory-students.repository.js';
import { PeriodsService } from './periods/periods.service.js';
import { SchedulesService } from './schedules.service.js';
import {
  INSTANCE_HORIZON_DAYS,
  type SchedulesConfig,
} from './schedules.config.js';

export const testSchedulesConfig: SchedulesConfig = {
  entryOpenMinutes: 10,
  entryCloseMinutes: 5,
  instanceHorizonDays: INSTANCE_HORIZON_DAYS,
};

/** Monday 2026-11-02 at 09:00 Bogota (14:00 UTC). */
export const MONDAY_9AM_BOGOTA = new Date('2026-11-02T14:00:00Z');

/** Test fixture: the schedules module on in-memory repositories and a movable clock. */
export function buildSchedulesFixture(start: Date = MONDAY_9AM_BOGOTA) {
  let current = new Date(start);
  const clock: Clock = { now: () => new Date(current) };
  const schedulesRepo = new InMemorySchedulesRepository();
  const instancesRepo = new InMemoryInstancesRepository();
  const eventLogRepo = new InMemoryEventLogRepository();
  const studentsRepo = new InMemoryStudentsRepository();
  const students = buildStudentsService(studentsRepo, eventLogRepo).service;
  const periodsRepo = new InMemoryPeriodsRepository();
  const instances = new InstancesService(
    schedulesRepo,
    instancesRepo,
    testSchedulesConfig,
    periodsRepo,
  );
  const eventLogService = new EventLogService(eventLogRepo);
  const schedules = new SchedulesService(
    schedulesRepo,
    students,
    instances,
    clock,
    eventLogService,
    periodsRepo,
  );
  const periods = new PeriodsService(
    periodsRepo,
    schedulesRepo,
    schedules,
    new EventLogService(eventLogRepo),
  );

  return {
    clock,
    eventLogRepo,
    eventLogService,
    studentsRepo,
    schedulesRepo,
    instancesRepo,
    periodsRepo,
    periods,
    students,
    instances,
    schedules,
    setNow: (date: Date) => {
      current = new Date(date);
    },
    newStudent: (document = '100') =>
      students.create({
        document,
        name: `Student ${document}`,
        program: null,
        consented: true,
      }),
    /** Weekly schedule of today (Monday) with Bogota times. */
    weekly: (name: string, start: string, end: string) =>
      schedules.create({ name, weekday: 1, start, end }),
  };
}
