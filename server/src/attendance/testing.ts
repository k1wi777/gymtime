import { EventLogService } from '../common/audit/event-log.service.js';
import type { Clock } from '../common/time/clock.js';
import {
  MONDAY_9AM_BOGOTA,
  buildSchedulesFixture,
} from '../schedules/testing.js';
import type { Student } from '../students/domain/student.js';
import type { SyncService } from '../sync/sync.service.js';
import { AttendanceService } from './attendance.service.js';
import type { AlarmPort } from './domain/alarm.port.js';
import { InMemoryAttendanceRepository } from './infrastructure/in-memory-attendance.repository.js';

/**
 * Test fixture: attendance on in-memory repositories, the real schedules
 * service and a stubbed sync that resolves slots to students.
 */
export function buildAttendanceFixture(start: Date = MONDAY_9AM_BOGOTA) {
  const schedules = buildSchedulesFixture(start);
  let current = new Date(start);
  const clock: Clock = { now: () => new Date(current) };
  const repository = new InMemoryAttendanceRepository();
  const onInstanceEmptied = vi.fn();
  const onButtonPressed = vi.fn();
  const alarm: AlarmPort = { onInstanceEmptied, onButtonPressed };
  const findStudentBySlot = vi.fn();
  const sync = { findStudentBySlot } as unknown as SyncService;
  const service = new AttendanceService(
    repository,
    sync,
    schedules.instances,
    schedules.students,
    alarm,
    clock,
    new EventLogService(schedules.eventLogRepo),
  );

  return {
    ...schedules,
    service,
    repository,
    alarm,
    onInstanceEmptied,
    onButtonPressed,
    findStudentBySlot,
    setNow: (date: Date) => {
      current = new Date(date);
      schedules.setNow(date);
    },
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
      schedules.setNow(current);
    },
    /** Makes every scan resolve to `student` (or to nobody with null). */
    slot: (student: Student | null) => {
      findStudentBySlot.mockResolvedValue(student);
    },
  };
}
