import { z } from 'zod';

/** Reasons a fingerprint scan can be denied (`scan.result.payload.reason`). */
export const REJECT_REASONS = [
  'UNKNOWN_SLOT',
  'NO_ACTIVE_SCHEDULE',
  'NOT_IN_SCHEDULE',
  'OUTSIDE_ENTRY_WINDOW',
  'ALREADY_EXITED',
  'STUDENT_INACTIVE',
] as const;

/** Error codes carried by a negative `ack` (`ack.payload.error`). */
export const ACK_ERRORS = [
  'INVALID_MESSAGE',
  'UNSUPPORTED_VERSION',
  'UNKNOWN_TYPE',
  'UNAUTHORIZED',
  'NOT_AUTHENTICATED',
  'INTERNAL_ERROR',
] as const;

export const rejectReasonSchema = z.enum(REJECT_REASONS);
export const ackErrorSchema = z.enum(ACK_ERRORS);

export type RejectReason = z.infer<typeof rejectReasonSchema>;
export type AckError = z.infer<typeof ackErrorSchema>;

export const REJECT_REASON_DESCRIPTIONS: Record<RejectReason, string> = {
  UNKNOWN_SLOT: 'El slot de la huella no está asignado a ningún estudiante.',
  NO_ACTIVE_SCHEDULE:
    'No hay un horario en curso ni con ingreso abierto en este momento.',
  NOT_IN_SCHEDULE: 'El estudiante no pertenece al horario activo.',
  OUTSIDE_ENTRY_WINDOW: 'El ingreso está fuera de la ventana permitida.',
  ALREADY_EXITED: 'El estudiante ya registró su salida de esta sesión.',
  STUDENT_INACTIVE: 'El estudiante está dado de baja.',
};

export const ACK_ERROR_DESCRIPTIONS: Record<AckError, string> = {
  INVALID_MESSAGE: 'El mensaje no es JSON válido o no cumple el esquema.',
  UNSUPPORTED_VERSION: 'La versión del protocolo (v) no es soportada.',
  UNKNOWN_TYPE: 'El tipo de mensaje (type) no existe.',
  UNAUTHORIZED: 'El token del dispositivo en hello es inválido.',
  NOT_AUTHENTICATED: 'Se recibió un mensaje antes de un hello válido.',
  INTERNAL_ERROR: 'Error interno del receptor al procesar el mensaje.',
};
