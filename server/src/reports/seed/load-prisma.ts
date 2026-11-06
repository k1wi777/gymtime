import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  SEMESTER_PERIOD_NAME,
  SIM_DOCUMENT_PREFIX,
  type SeedDataset,
} from './semester.js';

const BATCH = 2000;

async function inBatches<T>(
  items: readonly T[],
  write: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) {
    await write(items.slice(i, i + BATCH));
  }
}

const timeOf = (time: string) => new Date(`1970-01-01T${time}Z`);
const dayOf = (date: string) => new Date(`${date}T00:00:00Z`);

export interface LoadResult {
  /** False when the semester was already there and nothing was written. */
  loaded: boolean;
  counts: Record<string, number>;
  /** The period was left inactive because another one is active. */
  periodActive: boolean;
}

/** True when the dataset's period is already in the database. */
export async function isLoaded(
  prisma: PrismaClient,
  data: SeedDataset,
): Promise<boolean> {
  return (
    (await prisma.period.findUnique({ where: { id: data.period.id } })) !== null
  );
}

/**
 * Writes the dataset in dependency order inside one transaction, with the
 * ids it carries. Everything is marked: documents `SIM-####` and the period
 * named "Simulación ...", which is what `resetSimulation` finds again.
 */
export async function loadSemesterInPrisma(
  prisma: PrismaClient,
  data: SeedDataset,
): Promise<LoadResult> {
  if (await isLoaded(prisma, data)) {
    return { loaded: false, counts: {}, periodActive: false };
  }
  const otherActive =
    (await prisma.period.count({ where: { active: true } })) > 0;
  await prisma.$transaction(
    async (tx) => {
      await tx.period.create({
        data: {
          id: data.period.id,
          name: data.period.name,
          startDate: dayOf(data.period.startDate),
          endDate: dayOf(data.period.endDate),
          active: !otherActive,
        },
      });
      await tx.serviceException.createMany({
        data: data.exceptions.map((e) => ({
          id: e.id,
          periodId: e.periodId,
          from: dayOf(e.from),
          to: dayOf(e.to),
          reason: e.reason,
        })),
      });
      await inBatches(data.students, (batch) =>
        tx.student.createMany({
          data: batch.map((s) => ({
            id: s.id,
            document: s.document,
            name: s.name,
            program: s.program,
            displayName: s.displayName,
            active: s.active,
            consentVersion: s.consentVersion,
            consentAt: s.consentAt,
          })),
        }),
      );
      await tx.schedule.createMany({
        data: data.schedules.map((s) => ({
          id: s.id,
          name: s.name,
          weekday: s.weekday,
          startTime: timeOf(s.startTime),
          endTime: timeOf(s.endTime),
          periodId: s.periodId,
        })),
      });
      await inBatches(data.assignments, (batch) =>
        tx.scheduleStudent.createMany({ data: batch }),
      );
      await inBatches(data.instances, (batch) =>
        tx.scheduleInstance.createMany({
          data: batch.map((i) => ({
            id: i.id,
            scheduleId: i.scheduleId,
            date: dayOf(i.date),
            startsAt: i.startsAt,
            endsAt: i.endsAt,
            status: i.status,
          })),
        }),
      );
      await inBatches(data.sessions, (batch) =>
        tx.attendanceSession.createMany({ data: batch }),
      );
      await inBatches(data.alarms, (batch) =>
        tx.alarmEvent.createMany({ data: batch }),
      );
    },
    { timeout: 120_000 },
  );
  return {
    loaded: true,
    periodActive: !otherActive,
    counts: {
      students: data.students.length,
      schedules: data.schedules.length,
      assignments: data.assignments.length,
      instances: data.instances.length,
      sessions: data.sessions.length,
      alarms: data.alarms.length,
    },
  };
}

/**
 * Deletes only what the simulation created: students whose document starts
 * with `SIM-` (their sessions and intervals go with them) and the period named
 * "Simulación ..." with its schedules, occurrences and alarms. Anything else is
 * untouched.
 */
export async function resetSimulation(
  prisma: PrismaClient,
): Promise<Record<string, number>> {
  const periods = await prisma.period.findMany({
    where: { name: SEMESTER_PERIOD_NAME },
    select: { id: true },
  });
  const periodIds = periods.map((p) => p.id);
  return prisma.$transaction(
    async (tx) => {
      const schedules = await tx.schedule.deleteMany({
        where: { periodId: { in: periodIds } },
      });
      const students = await tx.student.deleteMany({
        where: { document: { startsWith: SIM_DOCUMENT_PREFIX } },
      });
      const removedPeriods = await tx.period.deleteMany({
        where: { id: { in: periodIds } },
      });
      return {
        schedules: schedules.count,
        students: students.count,
        periods: removedPeriods.count,
      };
    },
    { timeout: 120_000 },
  );
}
