import type { Schedule } from '../../schedules/domain/schedule.js';
import type { ScheduleInstance } from '../../schedules/domain/schedule-instance.js';

export interface StudentInfo {
  id: string;
  name: string;
  program: string | null;
}

/** Lookup tables the metrics use to label and group sessions. */
export interface ReportContext {
  now: Date;
  instances: ReadonlyMap<string, ScheduleInstance>;
  schedules: ReadonlyMap<string, Schedule>;
  students: ReadonlyMap<string, StudentInfo>;
}

export type GroupBy = 'student' | 'schedule' | 'month';

export const WEEKDAY_NAMES = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

export const weekdayName = (weekday: number): string =>
  WEEKDAY_NAMES[weekday - 1] ?? String(weekday);

/** `YYYY-MM` of an occurrence date. */
export const monthOf = (instance: Pick<ScheduleInstance, 'date'>): string =>
  instance.date.slice(0, 7);

/** "Lunes 18:00-19:00" or "Nombre" for the schedule column. */
export function scheduleLabel(schedule: Schedule | undefined): string {
  if (!schedule) return 'Horario eliminado';
  return schedule.name;
}

export function studentName(
  students: ReadonlyMap<string, StudentInfo>,
  id: string,
): string {
  return students.get(id)?.name ?? 'Estudiante desconocido';
}

export function studentProgram(
  students: ReadonlyMap<string, StudentInfo>,
  id: string,
): string | null {
  return students.get(id)?.program ?? null;
}

/** Key and label of the group an (student, occurrence) pair falls in. */
export function groupOf(
  groupBy: GroupBy,
  studentId: string,
  instance: ScheduleInstance,
  ctx: ReportContext,
): { key: string; label: string } {
  if (groupBy === 'student') {
    return { key: studentId, label: studentName(ctx.students, studentId) };
  }
  if (groupBy === 'schedule') {
    return {
      key: instance.scheduleId,
      label: scheduleLabel(ctx.schedules.get(instance.scheduleId)),
    };
  }
  const month = monthOf(instance);
  return { key: month, label: month };
}

/** Leading columns of a grouped table (the student also shows the program). */
export function groupColumns(groupBy: GroupBy) {
  const first = {
    student: { key: 'group', label: 'Estudiante', type: 'text' as const },
    schedule: { key: 'group', label: 'Horario', type: 'text' as const },
    month: { key: 'group', label: 'Mes', type: 'text' as const },
  }[groupBy];
  return groupBy === 'student'
    ? [first, { key: 'program', label: 'Programa', type: 'text' as const }]
    : [first];
}

/** Group cells of a row, plus its student id for the detail view. */
export function groupCells(
  groupBy: GroupBy,
  key: string,
  label: string,
  ctx: ReportContext,
): Record<string, string | null> {
  return groupBy === 'student'
    ? { id: key, group: label, program: studentProgram(ctx.students, key) }
    : { group: label };
}

/** Orders groups by label, then key, so tables are deterministic before sorting. */
export function byLabel<T extends { label: string; key: string }>(
  a: T,
  b: T,
): number {
  return a.label.localeCompare(b.label, 'es') || a.key.localeCompare(b.key);
}
