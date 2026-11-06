import { buildAlarmFixture } from '../alarm/testing.js';
import { ReportsService } from './reports.service.js';
import { loadSemesterInMemory } from './seed/load-memory.js';
import {
  SEMESTER_NOW,
  buildSemester,
  type SeedDataset,
} from './seed/semester.js';

/**
 * Test fixture: the real report service on in-memory repositories and a
 * movable clock, optionally with the simulated semester already loaded.
 */
export function buildReportsFixture(
  options: { now?: Date; dataset?: SeedDataset | 'semester' } = {},
) {
  const now = options.now ?? SEMESTER_NOW;
  const fixture = buildAlarmFixture(now);
  const service = new ReportsService(
    fixture.students,
    fixture.schedules,
    fixture.instances,
    fixture.periods,
    fixture.attendance,
    fixture.service,
    fixture.devices,
    fixture.eventLogService,
    fixture.clock,
  );
  const dataset =
    options.dataset === 'semester' ? buildSemester() : options.dataset;
  if (dataset) {
    loadSemesterInMemory(dataset, {
      students: fixture.studentsRepo,
      periods: fixture.periodsRepo,
      schedules: fixture.schedulesRepo,
      instances: fixture.instancesRepo,
      attendance: fixture.attendanceRepo,
      alarm: fixture.events,
    });
  }
  return { ...fixture, reports: service, dataset };
}
