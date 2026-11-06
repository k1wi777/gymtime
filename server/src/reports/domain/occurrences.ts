import type { ScheduleInstance } from '../../schedules/domain/schedule-instance.js';
import type { ScheduleAssignment } from '../../schedules/domain/schedules.repository.js';

/** True when the day of this schedule has no service (period exception). */
export type ClosedDays = (scheduleId: string, date: string) => boolean;

/** A student who owed attendance at an occurrence that already ended. */
export interface Obligation {
  studentId: string;
  instance: ScheduleInstance;
}

/** `endsAt <= now`: future and in-progress occurrences owe nothing yet. */
export const isFinished = (instance: ScheduleInstance, now: Date): boolean =>
  instance.endsAt.getTime() <= now.getTime();

/**
 * Whether one of the intervals covers `at`: `validFrom <= at` and the
 * interval is still open or closes after `at`. Evaluated at the start of the
 * occurrence: who is assigned at 15:00 does not owe the 14:00 one, and who is
 * unassigned at 14:30 still owes it.
 */
export function validAt(
  intervals: readonly Pick<ScheduleAssignment, 'validFrom' | 'validTo'>[],
  at: Date,
): boolean {
  return intervals.some(
    (i) =>
      i.validFrom.getTime() <= at.getTime() &&
      (i.validTo === null || i.validTo.getTime() > at.getTime()),
  );
}

export interface ObligationInput {
  occurrences: readonly ScheduleInstance[];
  assignments: readonly ScheduleAssignment[];
  closedOn: ClosedDays;
  now: Date;
  /** Restricts to these students; null = everybody. */
  studentIds: ReadonlySet<string> | null;
}

/**
 * (student, finished occurrence outside days without service) pairs with a
 * validity interval open at the start. Ordered by occurrence start, then
 * student id, so results are deterministic.
 */
export function computeObligations(input: ObligationInput): Obligation[] {
  const bySchedule = new Map<string, Map<string, ScheduleAssignment[]>>();
  for (const a of input.assignments) {
    if (input.studentIds && !input.studentIds.has(a.studentId)) continue;
    let students = bySchedule.get(a.scheduleId);
    if (!students) bySchedule.set(a.scheduleId, (students = new Map()));
    const list = students.get(a.studentId);
    if (list) list.push(a);
    else students.set(a.studentId, [a]);
  }
  const result: Obligation[] = [];
  const finished = input.occurrences
    .filter(
      (o) => isFinished(o, input.now) && !input.closedOn(o.scheduleId, o.date),
    )
    .sort(
      (a, b) =>
        a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id),
    );
  for (const instance of finished) {
    const students = bySchedule.get(instance.scheduleId);
    if (!students) continue;
    for (const studentId of [...students.keys()].sort()) {
      if (validAt(students.get(studentId) ?? [], instance.startsAt)) {
        result.push({ studentId, instance });
      }
    }
  }
  return result;
}

/** `studentId|instanceId` key to look sessions up per obligation. */
export const pairKey = (studentId: string, instanceId: string): string =>
  `${studentId}|${instanceId}`;
