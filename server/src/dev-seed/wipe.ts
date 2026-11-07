import type { Prisma } from '../generated/prisma/client.js';

type Db = Prisma.TransactionClient;
interface Table {
  count(): Promise<number>;
  deleteMany(): Promise<{ count: number }>;
}

/**
 * Every table the seed empties, in the order that respects the foreign keys
 * (children first). `_prisma_migrations` is not here on purpose: the schema
 * and its history are kept. `wipe.spec.ts` fails if the schema gets a table
 * that is neither listed here nor deliberately excluded.
 */
export const WIPE_ORDER: ReadonlyArray<readonly [string, (db: Db) => Table]> = [
  ['offline_events', (db) => db.offlineEvent],
  ['offline_snapshots', (db) => db.offlineSnapshot],
  ['alarm_events', (db) => db.alarmEvent],
  ['attendance_sessions', (db) => db.attendanceSession],
  ['schedule_students', (db) => db.scheduleStudent],
  ['schedule_instances', (db) => db.scheduleInstance],
  ['schedules', (db) => db.schedule],
  ['service_exceptions', (db) => db.serviceException],
  ['periods', (db) => db.period],
  ['enrollments', (db) => db.enrollment],
  ['device_slots', (db) => db.deviceSlot],
  ['device_commands', (db) => db.deviceCommand],
  ['fingerprints', (db) => db.fingerprint],
  ['processed_messages', (db) => db.processedMessage],
  ['students', (db) => db.student],
  ['import_batches', (db) => db.importBatch],
  ['auth_sessions', (db) => db.authSession],
  ['panel_users', (db) => db.panelUser],
  ['devices', (db) => db.device],
  ['event_log', (db) => db.eventLog],
];

export const WIPE_TABLES: readonly string[] = WIPE_ORDER.map(([name]) => name);

/** `deleteMany` per table, in order, inside the caller's transaction. */
export async function wipeAll(db: Db): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};
  for (const [name, table] of WIPE_ORDER) {
    removed[name] = (await table(db).deleteMany()).count;
  }
  return removed;
}
