import type { InMemoryAlarmRepository } from '../../alarm/infrastructure/in-memory-alarm.repository.js';
import type { InMemoryAttendanceRepository } from '../../attendance/infrastructure/in-memory-attendance.repository.js';
import type { InMemoryInstancesRepository } from '../../schedules/infrastructure/in-memory-instances.repository.js';
import type { InMemorySchedulesRepository } from '../../schedules/infrastructure/in-memory-schedules.repository.js';
import type { InMemoryPeriodsRepository } from '../../schedules/periods/in-memory-periods.repository.js';
import type { InMemoryStudentsRepository } from '../../students/infrastructure/in-memory-students.repository.js';
import type { Student } from '../../students/domain/student.js';
import type { SeedDataset, SeedStudent } from './semester.js';

export interface MemoryTargets {
  students: InMemoryStudentsRepository;
  periods: InMemoryPeriodsRepository;
  schedules: InMemorySchedulesRepository;
  instances: InMemoryInstancesRepository;
  attendance: InMemoryAttendanceRepository;
  alarm: InMemoryAlarmRepository;
}

/**
 * Puts the dataset into in-memory repositories: the tests and the panel's
 * browser harness open the reports with it. The ids are the dataset's own.
 */
export function loadSemesterInMemory(
  data: SeedDataset,
  targets: MemoryTargets,
): void {
  targets.students.load(data.students.map((s) => withoutProfile(s)));
  targets.periods.load(data.period, data.exceptions);
  targets.schedules.load(data.schedules, data.assignments);
  targets.instances.load(data.instances);
  targets.attendance.load(data.sessions);
  targets.alarm.load(data.alarms);
}

/** The scripted behaviour is generator data, not a student field. */
function withoutProfile(student: SeedStudent): Student {
  const { profile, ...fields } = student;
  void profile;
  return fields;
}
