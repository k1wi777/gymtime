import { ApiError } from './client';

/** Spanish text for the stable codes the API sends. */
const BY_CODE: Record<string, string> = {
  INVALID_CREDENTIALS:
    'Usuario o contraseña incorrectos, o la cuenta está bloqueada.',
  RATE_LIMITED: 'Demasiados intentos. Espere un momento antes de reintentar.',
  FORBIDDEN_ROLE: 'Su rol no permite esta operación.',
  CSRF_REJECTED:
    'La petición fue rechazada por seguridad. Recargue la página e intente de nuevo.',
  PASSWORD_CHANGE_REQUIRED:
    'Debe cambiar la contraseña temporal para continuar.',
  INVALID_CURRENT_PASSWORD: 'La contraseña actual no es correcta.',
  ACCOUNT_REQUIRED: 'Esta operación requiere una cuenta con sesión iniciada.',
  NO_DEVICE: 'No hay ningún lector registrado todavía.',
  // Attendance
  UNKNOWN_SLOT: 'La huella no está asignada a ningún estudiante.',
  NO_ACTIVE_SCHEDULE: 'No hay un horario activo en este momento.',
  NOT_IN_SCHEDULE: 'El estudiante no pertenece al horario activo.',
  OUTSIDE_ENTRY_WINDOW: 'El ingreso está fuera de la ventana permitida.',
  ALREADY_EXITED: 'El estudiante ya registró su salida de este horario.',
  STUDENT_INACTIVE: 'El estudiante está dado de baja.',
  SESSION_ALREADY_OPEN: 'El estudiante ya tiene una entrada abierta.',
  NO_OPEN_SESSION: 'El estudiante no tiene una entrada abierta.',
  STUDENT_NOT_FOUND: 'El estudiante no existe.',
  // Enrollment
  DEVICE_UNAVAILABLE:
    'El lector no está disponible. Verifique que esté en línea.',
  DEVICE_BUSY: 'El lector ya tiene un enrolamiento en curso.',
  ENROLLMENT_NOT_FOUND: 'El enrolamiento no existe.',
  ENROLLMENT_FINISHED: 'El enrolamiento ya había terminado.',
  // Alarm
  ALARM_NOT_ON: 'La alarma no está encendida.',
  NO_DEVICE_ONLINE: 'No hay un lector en línea.',
  // Consent (H9)
  CONSENT_REQUIRED:
    'Falta el consentimiento del estudiante: regístrelo antes de enrolar la huella.',
  CONSENT_VERSION_STALE:
    'El texto de consentimiento cambió. Vuelva a abrirlo y léalo de nuevo.',
  // Users (H9)
  LAST_ADMIN: 'No se puede dejar el sistema sin un administrador activo.',
  SELF_CHANGE_FORBIDDEN:
    'No puede desactivarse ni cambiar su propio rol; pídaselo a otro administrador.',
  USERNAME_TAKEN: 'Ese nombre de usuario ya existe.',
  // Periods and schedules (H9)
  PERIOD_NOT_FOUND: 'El periodo no existe.',
  EXCEPTION_NOT_FOUND: 'El día sin servicio no existe.',
};

/**
 * Codes whose message the server already words in Spanish and names what
 * clashes (the period, the schedule, the missing column): shown as it comes.
 */
const SERVER_WORDED = new Set([
  'PASSWORD_POLICY',
  'PERIOD_OVERLAP',
  'PERIOD_HAS_SCHEDULES',
  'PERIOD_EXCLUDES_EXCEPTION',
  'EXCEPTION_OUT_OF_PERIOD',
  'INVALID_RANGE',
  'SCHEDULE_OVERLAP',
  'SCHEDULE_HAS_ATTENDANCE',
  'INVALID_CSV',
  'MAPPING_INCOMPLETE',
  'IMPORT_CONFLICT',
]);

/** Text of a stable code (error or scan rejection), or undefined. */
export const messageForCode = (code: string): string | undefined =>
  BY_CODE[code];

const BY_STATUS: Record<number, string> = {
  0: 'No hay conexión con el servidor. Revise la red e intente de nuevo.',
  400: 'Los datos enviados no son válidos.',
  401: 'Su sesión expiró. Inicie sesión de nuevo.',
  403: 'No tiene permisos para esta operación.',
  404: 'No se encontró lo solicitado.',
  409: 'La operación no es posible en el estado actual.',
  429: 'Demasiados intentos. Espere un momento antes de reintentar.',
};

/**
 * Message for the user. A known `code` always wins over the server's own text,
 * so the screen never shows raw English or internal wording.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && SERVER_WORDED.has(error.code)) return error.message;
    if (error.code && BY_CODE[error.code]) {
      const base = BY_CODE[error.code] as string;
      return error.status === 429 && error.retryAfterSeconds
        ? `${base} (reintente en ${error.retryAfterSeconds} s)`
        : base;
    }
    if (error.status === 429 && error.retryAfterSeconds) {
      return `${BY_STATUS[429]} (reintente en ${error.retryAfterSeconds} s)`;
    }
    if (error.status >= 500) {
      return 'El servidor tuvo un problema. Intente de nuevo en unos segundos.';
    }
    return BY_STATUS[error.status] ?? 'Ocurrió un error inesperado.';
  }
  return 'Ocurrió un error inesperado.';
}

/** Server validation issues as `{ field: message }` for the form fields. */
export function issuesByField(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(
    error.issues.map((issue) => [issue.path, issue.message]),
  );
}
