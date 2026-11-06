import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { PrismaAlarmRepository } from '../../alarm/infrastructure/prisma-alarm.repository.js';
import { PrismaAttendanceRepository } from '../../attendance/infrastructure/prisma-attendance.repository.js';
import { PrismaInstancesRepository } from '../../schedules/infrastructure/prisma-instances.repository.js';
import { PrismaSchedulesRepository } from '../../schedules/infrastructure/prisma-schedules.repository.js';
import { PrismaPeriodsRepository } from '../../schedules/periods/prisma-periods.repository.js';
import { PrismaStudentsRepository } from '../../students/infrastructure/prisma-students.repository.js';
import { databaseName } from '../seed/safety.js';
import { describeReportReads } from './read-contracts.js';

const url = process.env.DATABASE_URL ?? '';
// The suite truncates tables between tests: only a throw-away database.
const disposable = /reports_check/.test(
  databaseName(url || 'postgresql://x/x'),
);

describe.runIf(process.env.V15_PHASE === 'contract' && disposable)(
  'V15 contract on PostgreSQL',
  () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });
    afterAll(() => prisma.$disconnect());

    describeReportReads('prisma', async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE students, periods, schedules, schedule_instances, schedule_students, attendance_sessions, alarm_events CASCADE',
      );
      const service = prisma as unknown as PrismaService;
      return {
        students: new PrismaStudentsRepository(service),
        periods: new PrismaPeriodsRepository(service),
        schedules: new PrismaSchedulesRepository(service),
        instances: new PrismaInstancesRepository(service),
        attendance: new PrismaAttendanceRepository(service),
        alarm: new PrismaAlarmRepository(service),
      };
    });
  },
);
