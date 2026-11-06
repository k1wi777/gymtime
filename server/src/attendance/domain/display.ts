import { DISPLAY_DEFAULTS, type RejectReason } from '@gymtime/shared';

/** What the reader shows after a scan (`scan.result.payload.display`). */
export interface ScanDisplay {
  line1: string;
  line2: string;
  /** Free text in protocol v0: `green` for accepted, `red` otherwise. */
  color: string;
}

/** Screen size; the texts are cut to it as a last defence. */
export interface DisplayLayout {
  cols: number;
  rows: number;
}

export const DISPLAY_COLORS = { accepted: 'green', rejected: 'red' } as const;

const DEFAULT_LAYOUT: DisplayLayout = {
  cols: DISPLAY_DEFAULTS.cols,
  rows: DISPLAY_DEFAULTS.rows,
};

/**
 * Anexo B of the iteration 2 backlog: ASCII only (no accents) and at most 16
 * characters per line. `null` in `line1` means the student's display name.
 */
/** Shown to an unrecognised fingerprint (`unknown`) and to an unknown slot. */
export const UNKNOWN_LINES = {
  line1: 'No reconocida',
  line2: 'Intente de nuevo',
} as const;

const REJECT_LINES: Record<
  RejectReason,
  { line1: string | null; line2: string }
> = {
  UNKNOWN_SLOT: UNKNOWN_LINES,
  NOT_IN_SCHEDULE: { line1: null, line2: 'No es su horario' },
  NO_ACTIVE_SCHEDULE: { line1: 'Sin horario', line2: 'en este momento' },
  // "Ingreso abre a las HH:MM" is reserved: `decide()` cannot tell "before
  // the window opens" apart yet (see docs/mensajes_pantalla.md).
  OUTSIDE_ENTRY_WINDOW: { line1: 'Ingreso cerrado', line2: '' },
  ALREADY_EXITED: { line1: null, line2: 'Ya marco salida' },
  STUDENT_INACTIVE: { line1: null, line2: 'No habilitado' },
};

/** Reserved for the day the server can answer a scan with an error. */
export const SYSTEM_ERROR_LINES = {
  line1: 'Error de sistema',
  line2: 'Llame asistente',
} as const;

/** Alarm while someone has not registered their exit (`PENDING_EXIT`). */
export const ALARM_LINES = {
  line1: 'Tiempo cumplido',
  line2: 'Registre salida',
} as const;

const FALLBACK_NAME = 'Estudiante';

function compose(
  line1: string,
  line2: string,
  color: string,
  layout: DisplayLayout,
): ScanDisplay {
  return {
    line1: line1.slice(0, layout.cols),
    line2: layout.rows < 2 ? '' : line2.slice(0, layout.cols),
    color,
  };
}

export function entryDisplay(
  displayName: string,
  layout: DisplayLayout = DEFAULT_LAYOUT,
): ScanDisplay {
  return compose(displayName, 'Entrada OK', DISPLAY_COLORS.accepted, layout);
}

export function exitDisplay(
  displayName: string,
  layout: DisplayLayout = DEFAULT_LAYOUT,
): ScanDisplay {
  return compose(displayName, 'Salida OK', DISPLAY_COLORS.accepted, layout);
}

export function deniedDisplay(
  reason: RejectReason,
  displayName: string | null,
  layout: DisplayLayout = DEFAULT_LAYOUT,
): ScanDisplay {
  const lines = REJECT_LINES[reason];
  return compose(
    lines.line1 ?? displayName ?? FALLBACK_NAME,
    lines.line2,
    DISPLAY_COLORS.rejected,
    layout,
  );
}

export function unknownDisplay(
  layout: DisplayLayout = DEFAULT_LAYOUT,
): ScanDisplay {
  return compose(
    UNKNOWN_LINES.line1,
    UNKNOWN_LINES.line2,
    DISPLAY_COLORS.rejected,
    layout,
  );
}
