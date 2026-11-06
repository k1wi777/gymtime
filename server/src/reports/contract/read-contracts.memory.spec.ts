import { InMemoryAlarmRepository } from '../../alarm/infrastructure/in-memory-alarm.repository.js';
import { InMemoryAttendanceRepository } from '../../attendance/infrastructure/in-memory-attendance.repository.js';
import { InMemoryInstancesRepository } from '../../schedules/infrastructure/in-memory-instances.repository.js';
import { InMemorySchedulesRepository } from '../../schedules/infrastructure/in-memory-schedules.repository.js';
import { InMemoryPeriodsRepository } from '../../schedules/periods/in-memory-periods.repository.js';
import { InMemoryStudentsRepository } from '../../students/infrastructure/in-memory-students.repository.js';
import { describeReportReads } from './read-contracts.js';

describeReportReads('in memory', async () => ({
  students: new InMemoryStudentsRepository(),
  periods: new InMemoryPeriodsRepository(),
  schedules: new InMemorySchedulesRepository(),
  instances: new InMemoryInstancesRepository(),
  attendance: new InMemoryAttendanceRepository(),
  alarm: new InMemoryAlarmRepository(),
}));
