import { randomBytes } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import type { PasswordHasher } from '../auth/password-hasher.js';
import type {
  EncryptedTemplate,
  TemplateCipher,
} from '../fingerprints/crypto/template-cipher.service.js';
import { DEMO_USERS, type DemoDataset } from './dataset.js';
import { wipeAll } from './wipe.js';

type Db = Prisma.TransactionClient;

const timeOf = (time: string) => new Date(`1970-01-01T${time}Z`);
const dayOf = (date: string) => new Date(`${date}T00:00:00Z`);

/** What needs CPU or randomness is prepared before the transaction opens. */
export interface Prepared {
  passwordHashes: Record<string, string>;
  templates: Map<string, EncryptedTemplate>;
}

/**
 * Password hashes (argon2id, as the application does) and the sealed
 * templates. The templates are random bytes of the size the reader produces,
 * never a capture: they match no finger. Encrypted with the current key and
 * the same mechanism as the real ones.
 */
export async function prepareSecrets(
  data: DemoDataset,
  tools: {
    hasher: PasswordHasher;
    cipher: TemplateCipher;
    templateBytes: number;
  },
): Promise<Prepared> {
  const passwordHashes: Record<string, string> = {};
  for (const user of DEMO_USERS) {
    passwordHashes[user.username] = await tools.hasher.hash(user.password);
  }
  const templates = new Map<string, EncryptedTemplate>();
  for (const fingerprint of data.fingerprints) {
    templates.set(
      fingerprint.id,
      tools.cipher.encrypt(randomBytes(tools.templateBytes)),
    );
  }
  return { passwordHashes, templates };
}

/** Writes the whole dataset in dependency order; ids are the dataset's own. */
export async function insertDataset(
  db: Db,
  data: DemoDataset,
  prepared: Prepared,
): Promise<Record<string, number>> {
  await db.panelUser.createMany({
    data: data.panelUsers.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      passwordHash: prepared.passwordHashes[u.username]!,
      role: u.role,
      mustChangePassword: false,
    })),
  });
  await db.importBatch.createMany({ data: data.importBatches });
  await db.student.createMany({
    data: data.students.map((s) => ({
      id: s.id,
      document: s.document,
      name: s.name,
      program: s.program,
      displayName: s.displayName,
      email: s.email,
      phone: s.phone,
      active: s.active,
      consentVersion: s.consentVersion,
      consentAt: s.consentAt,
      consentBy: s.consented ? data.adminId : null,
      anonymizedAt: s.anonymizedAt ?? null,
      importBatchId: data.importedBy[s.id] ?? null,
    })),
  });
  await db.fingerprint.createMany({
    data: data.fingerprints.map((f) => {
      const sealed = prepared.templates.get(f.id)!;
      return {
        id: f.id,
        studentId: f.studentId,
        template: new Uint8Array(sealed.data),
        iv: new Uint8Array(sealed.iv),
        keyVersion: sealed.keyVersion,
        createdAt: f.createdAt,
      };
    }),
  });
  await db.device.create({
    data: {
      id: data.device.id,
      name: data.device.name,
      firmwareVersion: data.device.firmwareVersion,
      lastConnectedAt: data.device.lastConnectedAt,
      online: false,
      capabilities: data.device.capabilities,
    },
  });
  await db.period.create({
    data: {
      id: data.period.id,
      name: data.period.name,
      startDate: dayOf(data.period.startDate),
      endDate: dayOf(data.period.endDate),
      active: data.period.active,
    },
  });
  await db.serviceException.createMany({
    data: data.exceptions.map((e) => ({
      id: e.id,
      periodId: e.periodId,
      from: dayOf(e.from),
      to: dayOf(e.to),
      reason: e.reason,
    })),
  });
  await db.schedule.createMany({
    data: data.schedules.map((s) => ({
      id: s.id,
      name: s.name,
      weekday: s.weekday,
      date: s.date === null ? null : dayOf(s.date),
      startTime: timeOf(s.startTime),
      endTime: timeOf(s.endTime),
      periodId: s.periodId,
    })),
  });
  await db.scheduleStudent.createMany({ data: data.assignments });
  await db.scheduleInstance.createMany({
    data: data.instances.map((i) => ({
      id: i.id,
      scheduleId: i.scheduleId,
      date: dayOf(i.date),
      startsAt: i.startsAt,
      endsAt: i.endsAt,
      status: i.status,
    })),
  });
  await db.attendanceSession.createMany({ data: data.sessions });
  await db.alarmEvent.createMany({ data: data.alarms });
  await db.offlineSnapshot.createMany({ data: data.snapshots });
  await db.offlineEvent.createMany({ data: data.offlineEvents });
  await db.eventLog.createMany({
    data: data.eventLog.map((e) => ({
      type: e.type,
      detail: e.detail as Prisma.InputJsonValue,
      actorType: e.actorType,
      actorId: e.actorId,
      createdAt: e.createdAt,
    })),
  });
  return {
    panel_users: data.panelUsers.length,
    import_batches: data.importBatches.length,
    students: data.students.length,
    fingerprints: data.fingerprints.length,
    devices: 1,
    periods: 1,
    service_exceptions: data.exceptions.length,
    schedules: data.schedules.length,
    schedule_students: data.assignments.length,
    schedule_instances: data.instances.length,
    attendance_sessions: data.sessions.length,
    alarm_events: data.alarms.length,
    offline_snapshots: data.snapshots.length,
    offline_events: data.offlineEvents.length,
    event_log: data.eventLog.length,
  };
}

export interface SeedOutcome {
  removed: Record<string, number>;
  created: Record<string, number>;
}

/**
 * Empties the tables of the wipe list and loads the dataset in ONE
 * transaction: if either step fails, nothing changes (R16).
 */
export async function replaceWithDataset(
  prisma: {
    $transaction: <T>(
      fn: (db: Db) => Promise<T>,
      o?: { timeout: number },
    ) => Promise<T>;
  },
  data: DemoDataset,
  prepared: Prepared,
): Promise<SeedOutcome> {
  return prisma.$transaction(
    async (db) => {
      const removed = await wipeAll(db);
      const created = await insertDataset(db, data, prepared);
      return { removed, created };
    },
    { timeout: 120_000 },
  );
}
