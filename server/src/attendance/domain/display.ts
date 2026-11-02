import type { RejectReason } from '@gymtime/shared';

/** What the reader shows after a scan (`scan.result.payload.display`). */
export interface ScanDisplay {
  line1: string;
  line2: string;
  /** Free text in protocol v0: `green` for accepted, `red` otherwise. */
  color: string;
}

export const DISPLAY_COLORS = { accepted: 'green', rejected: 'red' } as const;

const REJECT_TEXTS: Record<RejectReason, string> = {
  UNKNOWN_SLOT: 'Huella no registrada',
  NO_ACTIVE_SCHEDULE: 'Sin horario activo',
  NOT_IN_SCHEDULE: 'No está en el horario',
  OUTSIDE_ENTRY_WINDOW: 'Fuera del horario de ingreso',
  ALREADY_EXITED: 'Ya registró su salida',
  STUDENT_INACTIVE: 'Estudiante inactivo',
};

export function entryDisplay(studentName: string): ScanDisplay {
  return {
    line1: 'Entrada registrada',
    line2: studentName,
    color: DISPLAY_COLORS.accepted,
  };
}

export function exitDisplay(studentName: string): ScanDisplay {
  return {
    line1: 'Salida registrada',
    line2: studentName,
    color: DISPLAY_COLORS.accepted,
  };
}

export function deniedDisplay(
  reason: RejectReason,
  studentName: string | null,
): ScanDisplay {
  const detail = REJECT_TEXTS[reason];
  return {
    line1: 'Acceso denegado',
    line2: studentName ? `${studentName}: ${detail}` : detail,
    color: DISPLAY_COLORS.rejected,
  };
}

export const UNKNOWN_DISPLAY: ScanDisplay = {
  line1: 'Huella no reconocida',
  line2: '',
  color: DISPLAY_COLORS.rejected,
};
