import { InMemoryStudentsRepository } from '../../students/infrastructure/in-memory-students.repository.js';
import { InMemoryOfflineEventsRepository } from '../infrastructure/in-memory-offline-events.repository.js';
import { InMemoryOfflineSnapshotsRepository } from '../infrastructure/in-memory-offline-snapshots.repository.js';
import { describeOfflineRepositories } from './offline-contracts.js';

describeOfflineRepositories('in memory', async () => ({
  events: new InMemoryOfflineEventsRepository(),
  snapshots: new InMemoryOfflineSnapshotsRepository(),
  students: new InMemoryStudentsRepository(),
  ensureDevice: async () => undefined,
}));
