import {
  buildDisplayPayload,
  type DisplayMessageContent,
  type DisplayPayload,
  type DisplayTone,
  type RejectReason,
} from '@gymtime/shared';

/** What the reader shows after a scan (`scan.result.payload.display`). */
export type ScanDisplay = DisplayPayload;

interface CatalogEntry {
  /** `null` means the student's display name. */
  title: string | null;
  subtitle: string;
  tone: DisplayTone;
}

const SUCCESS_TONE: DisplayTone = 'success';

/**
 * Message catalogue (docs/mensajes_pantalla.md). Accents are kept: the screen
 * is a TFT with the full font. The tone is fixed per case; the firmware picks
 * the RGB.
 */
const ENTRY: CatalogEntry = {
  title: null,
  subtitle: 'Entrada registrada',
  tone: SUCCESS_TONE,
};
const EXIT: CatalogEntry = {
  title: null,
  subtitle: 'Salida registrada',
  tone: SUCCESS_TONE,
};

/** Shown to an unrecognised fingerprint (`unknown`) and to an unknown slot. */
export const UNKNOWN_MESSAGE: DisplayMessageContent = {
  title: 'Huella no reconocida',
  subtitle: 'Intente de nuevo',
  tone: 'error',
};

const REJECT_CATALOG: Record<
  RejectReason,
  CatalogEntry | DisplayMessageContent
> = {
  UNKNOWN_SLOT: UNKNOWN_MESSAGE,
  NOT_IN_SCHEDULE: { title: null, subtitle: 'No es su horario', tone: 'error' },
  NO_ACTIVE_SCHEDULE: {
    title: 'Sin horario',
    subtitle: 'No hay un horario activo en este momento',
    tone: 'warning',
  },
  // "Ingreso abre a las HH:MM" is reserved: `decide()` cannot tell "before
  // the window opens" apart yet (see docs/mensajes_pantalla.md).
  OUTSIDE_ENTRY_WINDOW: {
    title: 'Ingreso cerrado',
    subtitle: 'El ingreso a este horario ya terminó',
    tone: 'warning',
  },
  ALREADY_EXITED: {
    title: null,
    subtitle: 'Ya registró su salida',
    tone: 'warning',
  },
  STUDENT_INACTIVE: {
    title: null,
    subtitle: 'No está habilitado',
    tone: 'error',
  },
};

/** Reserved for the day the server can answer a scan with an error. */
export const SYSTEM_ERROR_MESSAGE: DisplayMessageContent = {
  title: 'Error del sistema',
  subtitle: 'Llame al asistente',
  tone: 'error',
};

/** Alarm while someone has not registered their exit (`PENDING_EXIT`). */
export const ALARM_MESSAGE: DisplayMessageContent = {
  title: 'Tiempo cumplido',
  subtitle: 'Registre su salida',
  tone: 'warning',
};

/** Empties the screen when the alarm message is withdrawn. */
export const CLEAR_MESSAGE: DisplayMessageContent = {
  title: '',
  subtitle: '',
  tone: 'info',
};

const FALLBACK_NAME = 'Estudiante';

function compose(
  entry: CatalogEntry | DisplayMessageContent,
  displayName: string | null,
): ScanDisplay {
  return buildDisplayPayload({
    title: entry.title ?? displayName ?? FALLBACK_NAME,
    subtitle: entry.subtitle,
    tone: entry.tone,
  });
}

export function entryDisplay(displayName: string): ScanDisplay {
  return compose(ENTRY, displayName);
}

export function exitDisplay(displayName: string): ScanDisplay {
  return compose(EXIT, displayName);
}

export function deniedDisplay(
  reason: RejectReason,
  displayName: string | null,
): ScanDisplay {
  return compose(REJECT_CATALOG[reason], displayName);
}

export function unknownDisplay(): ScanDisplay {
  return compose(UNKNOWN_MESSAGE, null);
}
