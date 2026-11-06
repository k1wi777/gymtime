import type { paths } from '@/api/schema';

export const TABS = [
  { id: 'afluencia', label: 'Afluencia', kind: 'flow' },
  { id: 'asistencia', label: 'Asistencia', kind: 'attendance' },
  { id: 'permanencia', label: 'Permanencia', kind: 'stay' },
  { id: 'tardes', label: 'Llegadas tarde', kind: 'late' },
  { id: 'alarmas', label: 'Alarmas', kind: 'alarms' },
  { id: 'calidad', label: 'Calidad de los datos', kind: 'quality' },
] as const;
export type Tab = (typeof TABS)[number];
export type TabId = Tab['id'];
export type ReportKind = Tab['kind'];

export type GroupBy = 'student' | 'schedule' | 'month';
export const GROUP_LABELS: Record<GroupBy, string> = {
  student: 'Por estudiante',
  schedule: 'Por horario',
  month: 'Por mes',
};

/** The groupings each report offers (the first one is the default). */
export const GROUPINGS: Partial<Record<ReportKind, readonly GroupBy[]>> = {
  attendance: ['student', 'schedule', 'month'],
  stay: ['student', 'schedule', 'month'],
  late: ['student', 'schedule'],
};

/** Alarms belong to the occurrence: they ignore the student and the degree. */
export const IGNORES_PERSON_FILTERS: readonly ReportKind[] = ['alarms'];

export interface Filters {
  from: string;
  to: string;
  scheduleId: string;
  program: string;
  studentId: string;
}

export interface ReportState {
  tab: TabId;
  groupBy: GroupBy;
  filters: Filters;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (value: string): boolean => DAY.test(value);

export const tabOf = (id: TabId): Tab =>
  TABS.find((t) => t.id === id) ?? (TABS[0] as Tab);

/** State from the address bar; whatever is missing or unknown falls to its default. */
export function parseState(params: URLSearchParams): ReportState {
  const tab =
    TABS.find((t) => t.id === params.get('reporte'))?.id ?? 'afluencia';
  const groupings = GROUPINGS[tabOf(tab).kind];
  const asked = params.get('agrupar') as GroupBy | null;
  return {
    tab,
    groupBy:
      asked && groupings?.includes(asked)
        ? asked
        : (groupings?.[0] ?? 'student'),
    filters: {
      from: params.get('desde') ?? '',
      to: params.get('hasta') ?? '',
      scheduleId: params.get('horario') ?? '',
      program: params.get('programa') ?? '',
      studentId: params.get('estudiante') ?? '',
    },
  };
}

/** The address bar for a state (only what differs from empty). */
export function toParams(state: ReportState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('reporte', state.tab);
  if (GROUPINGS[tabOf(state.tab).kind]) params.set('agrupar', state.groupBy);
  const { from, to, scheduleId, program, studentId } = state.filters;
  if (from) params.set('desde', from);
  if (to) params.set('hasta', to);
  if (scheduleId) params.set('horario', scheduleId);
  if (program) params.set('programa', program);
  if (studentId) params.set('estudiante', studentId);
  return params;
}

export type ReportQuery = NonNullable<
  paths['/reports/attendance']['get']['parameters']['query']
>;

/** The API query of a state; empty filters are left out. */
export function toQuery(state: ReportState): ReportQuery {
  const { filters } = state;
  const kind = tabOf(state.tab).kind;
  const person = !IGNORES_PERSON_FILTERS.includes(kind);
  return {
    ...(isDay(filters.from) ? { from: filters.from } : {}),
    ...(isDay(filters.to) ? { to: filters.to } : {}),
    ...(filters.scheduleId ? { scheduleId: filters.scheduleId } : {}),
    ...(person && filters.program ? { program: filters.program } : {}),
    ...(person && filters.studentId ? { studentId: filters.studentId } : {}),
    ...(GROUPINGS[kind] ? { groupBy: state.groupBy } : {}),
  };
}

/** Days between two `YYYY-MM-DD` days, both included (UTC arithmetic: no zone effects). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

/** Local validation of the range, in Spanish; undefined when it is fine. */
export function rangeProblem(
  filters: Pick<Filters, 'from' | 'to'>,
  maxDays: number,
): string | undefined {
  const { from, to } = filters;
  if ((from && !isDay(from)) || (to && !isDay(to))) {
    return 'Use fechas con formato AAAA-MM-DD.';
  }
  if (from && to) {
    if (from > to) return 'La fecha inicial no puede ser posterior a la final.';
    if (daysBetween(from, to) > maxDays) {
      return `El rango no puede superar ${maxDays} días.`;
    }
  }
  return undefined;
}
