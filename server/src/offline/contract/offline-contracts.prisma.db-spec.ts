import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { PrismaStudentsRepository } from '../../students/infrastructure/prisma-students.repository.js';
import { databaseName } from '../../reports/seed/safety.js';
import { PrismaOfflineEventsRepository } from '../infrastructure/prisma-offline-events.repository.js';
import { PrismaOfflineSnapshotsRepository } from '../infrastructure/prisma-offline-snapshots.repository.js';
import { describeOfflineRepositories } from './offline-contracts.js';

const url = process.env.DATABASE_URL ?? '';
// The suite truncates tables between tests: only a throw-away database.
const disposable = /reports_check/.test(
  databaseName(url || 'postgresql://x/x'),
);

describe.runIf(process.env.V15_PHASE === 'contract' && disposable)(
  'V15 offline contract on PostgreSQL',
  () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
    });
    afterAll(() => prisma.$disconnect());

    describeOfflineRepositories('prisma', async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE students, devices, offline_events, offline_snapshots CASCADE',
      );
      const service = prisma as unknown as PrismaService;
      return {
        events: new PrismaOfflineEventsRepository(service),
        snapshots: new PrismaOfflineSnapshotsRepository(service),
        students: new PrismaStudentsRepository(service),
        ensureDevice: async (id: string) => {
          await prisma.device.create({ data: { id } });
        },
      };
    });
  },
);
