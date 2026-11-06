import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import type { ReportContext } from './context.js';
import { percent, type ReportTable } from './table.js';

/** States this report counts; "por revisar" arrives with H12 and is not simulated. */
export const QUALITY_STATES = ['abierta', 'cerrada', 'no_registrada'] as const;

export interface QualityCounts {
  total: number;
  manualEntry: number;
  manualExit: number;
  unregistered: number;
  staleOpen: number;
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
  };
  for (const s of sessions) {
    if (s.entrySource === 'manual') counts.manualEntry++;
    if (s.exitSource === 'manual') counts.manualExit++;
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
): ReportTable {
  const c = computeQualityCounts(sessions, ctx);
  const row = (indicator: string, count: number) => ({
    indicator,
    count,
    share: percent(count, c.total),
  });
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
    ],
    meta: { total: c.total, estados: [...QUALITY_STATES] },
  };
}
