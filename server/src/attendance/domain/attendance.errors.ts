import type { RejectReason } from '@gymtime/shared';

export type AttendanceErrorCode =
  | RejectReason
  | 'SESSION_ALREADY_OPEN'
  | 'NO_OPEN_SESSION'
  | 'STUDENT_NOT_FOUND';

const MESSAGES: Record<AttendanceErrorCode, string> = {
  UNKNOWN_SLOT: 'La huella no está asignada a ningún estudiante',
  NO_ACTIVE_SCHEDULE: 'No hay un horario activo en este momento',
  NOT_IN_SCHEDULE: 'El estudiante no pertenece al horario activo',
  OUTSIDE_ENTRY_WINDOW: 'El ingreso está fuera de la ventana permitida',
  ALREADY_EXITED: 'El estudiante ya registró su salida de este horario',
  STUDENT_INACTIVE: 'El estudiante está dado de baja',
  SESSION_ALREADY_OPEN: 'El estudiante ya tiene una sesión abierta',
  NO_OPEN_SESSION: 'El estudiante no tiene una sesión abierta',
  STUDENT_NOT_FOUND: 'El estudiante no existe',
};

/** Business rule rejection; the controller maps it to HTTP. */
export class AttendanceError extends Error {
  constructor(readonly code: AttendanceErrorCode) {
    super(MESSAGES[code]);
    this.name = 'AttendanceError';
  }
}
