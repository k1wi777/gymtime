import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import type { ReportContext } from './context.js';
import { percent, type ReportTable } from './table.js';

/** States this report counts; "por revisar" lives in the offline events (see `meta.offline`). */
export const QUALITY_STATES = ['abierta', 'cerrada', 'no_registrada'] as const;

export interface QualityCounts {
  total: number;
  manualEntry: number;
  manualExit: number;
  unregistered: number;
  staleOpen: number;
  /** Sessions with an entry or exit that came from the offline queue. */
  offlineSessions: number;
}

export interface QualityOffline {
  sessions: number;
  reconciled: number;
  pending: number;
  discarded: number;
}

export function computeQualityCounts(
  sessions: readonly AttendanceSession[],
  ctx: ReportContext,
): QualityCounts {
  const counts: QualityCounts = {
    total: sessions.length,
    manualEntry: 0,
    manualExit: 0,
    unregistered: 0,
    staleOpen: 0,
    offlineSessions: 0,
  };
  for (const s of sessions) {
    if (s.entrySource === 'manual') counts.manualEntry++;
    if (s.exitSource === 'manual') counts.manualExit++;
    if (s.entrySource === 'offline' || s.exitSource === 'offline') {
      counts.offlineSessions++;
    }
    if (s.status === 'no_registrada') counts.unregistered++;
    const instance = ctx.instances.get(s.instanceId);
    if (
      s.status === 'abierta' &&
      instance &&
      instance.endsAt.getTime() <= ctx.now.getTime()
    ) {
      counts.staleOpen++;
    }
  }
  return counts;
}

export function computeQuality(
  sessions: readonly AttendanceSession[],
  ctx: ReportContext,
  outcomes: Omit<QualityOffline, 'sessions'> = {
    reconciled: 0,
    pending: 0,
    discarded: 0,
  },
): ReportTable {
  const c = computeQualityCounts(sessions, ctx);
  const row = (indicator: string, count: number) => ({
    indicator,
    count,
    share: percent(count, c.total),
  });
  // Events are not sessions: their share of the sessions would mislead.
  const eventRow = (indicator: string, count: number) => ({
    indicator,
    count,
    share: null,
  });
  const hasOffline =
    c.offlineSessions +
      outcomes.reconciled +
      outcomes.pending +
      outcomes.discarded >
    0;
  return {
    columns: [
      { key: 'indicator', label: 'Indicador', type: 'text' },
      { key: 'count', label: 'Sesiones', type: 'int' },
      { key: 'share', label: '% del total', type: 'percent' },
    ],
    rows: [
      row('Entrada manual', c.manualEntry),
      row('Salida manual', c.manualExit),
      row('Sin salida registrada (no registrada)', c.unregistered),
      row('Abierta en un horario ya terminado', c.staleOpen),
      // Offline mode (H12): counted apart, and only when there is something
      // to count, so a range without it keeps the four rows of H10.
      ...(hasOffline
        ? [
            row('Sesiones con origen sin conexión', c.offlineSessions),
            eventRow('Eventos sin conexión reconciliados', outcomes.reconciled),
            eventRow('Eventos sin conexión por revisar', outcomes.pending),
            eventRow('Eventos sin conexión descartados', outcomes.discarded),
          ]
        : []),
    ],
    meta: {
      total: c.total,
      estados: [...QUALITY_STATES],
      offline: { sessions: c.offlineSessions, ...outcomes },
    },
  };
}
