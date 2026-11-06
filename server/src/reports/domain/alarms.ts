import type {
  AlarmClosedBy,
  AlarmEvent,
} from '../../alarm/domain/alarm-event.js';
import { scheduleLabel, type ReportContext } from './context.js';
import { average, round, type ReportRow, type ReportTable } from './table.js';

export const CLOSED_BY_LABELS: Record<AlarmClosedBy, string> = {
  all_exited: 'Todos salieron',
  button: 'Botón del lector',
  cli: 'Panel o línea de comandos',
  timeout: 'Tiempo agotado',
};

export interface AlarmSummary {
  total: number;
  closed: number;
  open: number;
  totalMinutes: number;
  averageMinutes: number | null;
  closedSessions: number;
  byClosure: Record<AlarmClosedBy, number>;
}

const minutesOf = (e: AlarmEvent): number =>
  e.endedAt ? (e.endedAt.getTime() - e.startedAt.getTime()) / 60_000 : 0;

/** `Σ byClosure + open = total` holds by construction: each event is counted once. */
export function summarizeAlarms(events: readonly AlarmEvent[]): AlarmSummary {
  const byClosure: Record<AlarmClosedBy, number> = {
    all_exited: 0,
    button: 0,
    cli: 0,
    timeout: 0,
  };
  let closed = 0;
  let minutes = 0;
  let closedSessions = 0;
  for (const e of events) {
    closedSessions += e.closedSessions;
    if (e.endedAt === null) continue;
    closed++;
    minutes += minutesOf(e);
    if (e.closedBy) byClosure[e.closedBy]++;
  }
  return {
    total: events.length,
    closed,
    open: events.length - closed,
    totalMinutes: round(minutes, 1),
    averageMinutes: average(minutes, closed),
    closedSessions,
    byClosure,
  };
}

/** One row per alarm, newest first, with the summary in `meta`. */
export function computeAlarms(
  events: readonly AlarmEvent[],
  ctx: ReportContext,
): ReportTable & { summary: AlarmSummary } {
  const rows: ReportRow[] = [...events]
    .sort(
      (a, b) =>
        b.startedAt.getTime() - a.startedAt.getTime() ||
        b.id.localeCompare(a.id),
    )
    .map((e) => {
      const instance = ctx.instances.get(e.instanceId);
      return {
        schedule: scheduleLabel(
          instance ? ctx.schedules.get(instance.scheduleId) : undefined,
        ),
        date: instance?.date ?? null,
        startedAt: e.startedAt.toISOString(),
        endedAt: e.endedAt?.toISOString() ?? null,
        minutes: e.endedAt ? round(minutesOf(e), 1) : null,
        closedBy: e.closedBy ? CLOSED_BY_LABELS[e.closedBy] : 'Abierta',
        closedSessions: e.closedSessions,
      };
    });
  const summary = summarizeAlarms(events);
  return {
    columns: [
      { key: 'schedule', label: 'Horario', type: 'text' },
      { key: 'date', label: 'Fecha', type: 'date' },
      { key: 'startedAt', label: 'Inicio', type: 'datetime' },
      { key: 'endedAt', label: 'Fin', type: 'datetime' },
      { key: 'minutes', label: 'Duración (min)', type: 'decimal' },
      { key: 'closedBy', label: 'Cierre', type: 'text' },
      { key: 'closedSessions', label: 'Sesiones cerradas', type: 'int' },
    ],
    rows,
    meta: { summary },
    summary,
  };
}
