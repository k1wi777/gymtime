import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import { scheduleLabel, type ReportContext } from './context.js';
import { delayMinutes } from './late.js';
import { pairKey, type Obligation } from './occurrences.js';
import { stayMinutes } from './stay.js';
import { round, type ReportRow, type ReportTable } from './table.js';

/** One row per obligated occurrence of the student, oldest first. */
export function computeStudentDetail(
  studentId: string,
  obligations: readonly Obligation[],
  sessions: readonly AttendanceSession[],
  ctx: ReportContext,
): ReportTable {
  const first = new Map<string, AttendanceSession>();
  for (const s of [...sessions].sort(
    (a, b) => a.enteredAt.getTime() - b.enteredAt.getTime(),
  )) {
    const key = pairKey(s.studentId, s.instanceId);
    if (!first.has(key)) first.set(key, s);
  }
  const rows: ReportRow[] = obligations
    .filter((o) => o.studentId === studentId)
    .map((o) => {
      const s = first.get(pairKey(studentId, o.instance.id));
      const minutes = s ? stayMinutes(s) : null;
      return {
        date: o.instance.date,
        schedule: scheduleLabel(ctx.schedules.get(o.instance.scheduleId)),
        result: s ? 'Asistió' : 'Faltó',
        enteredAt: s?.enteredAt.toISOString() ?? null,
        exitedAt: s?.exitedAt?.toISOString() ?? null,
        delay:
          s && s.entrySource === 'device'
            ? delayMinutes(s.enteredAt, o.instance.startsAt)
            : null,
        minutes: minutes === null ? null : round(minutes, 1),
        status: s?.status ?? null,
      };
    });
  return {
    columns: [
      { key: 'date', label: 'Fecha', type: 'date' },
      { key: 'schedule', label: 'Horario', type: 'text' },
      { key: 'result', label: 'Resultado', type: 'text' },
      { key: 'enteredAt', label: 'Entrada', type: 'datetime' },
      { key: 'exitedAt', label: 'Salida', type: 'datetime' },
      { key: 'delay', label: 'Retraso (min)', type: 'int' },
      { key: 'minutes', label: 'Permanencia (min)', type: 'decimal' },
      { key: 'status', label: 'Estado de la sesión', type: 'text' },
    ],
    rows,
    meta: {},
  };
}
