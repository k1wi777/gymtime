import type { EventOf } from '@/api/types';
import { messageForCode } from '@/api/errors';

/** Spanish texts for the vocabularies the server and the reader send. */
export const SCAN_RESULT_LABELS: Record<
  EventOf<'scan'>['data']['result'],
  string
> = {
  entry: 'Entrada',
  exit: 'Salida',
  denied: 'Rechazado',
  unknown: 'Huella desconocida',
};

export const rejectLabel = (reason: string | null): string =>
  (reason && messageForCode(reason)) || 'Rechazado';

export const ENROLL_STEPS = [
  'place_finger',
  'remove_finger',
  'place_again',
  'processing',
] as const;

export const ENROLL_STEP_LABELS: Record<string, string> = {
  place_finger: 'Ponga el dedo en el lector',
  remove_finger: 'Retire el dedo',
  place_again: 'Vuelva a poner el mismo dedo',
  processing: 'Procesando la huella',
};

/** Unknown steps (a newer firmware) are shown as the reader sent them. */
export const enrollStepLabel = (step: string): string =>
  ENROLL_STEP_LABELS[step] ?? step;

export const ENROLL_STATUS_LABELS: Record<string, string> = {
  pending: 'Esperando al lector',
  in_progress: 'En curso',
  done: 'Huella registrada',
  failed: 'Falló',
  expired: 'Expiró el tiempo',
  cancelled: 'Cancelado',
};

const FAILURE_LABELS: Record<string, string> = {
  DEVICE_UNAVAILABLE: 'El lector no respondió.',
  sim_fail: 'El lector no pudo capturar la huella.',
  timeout: 'El lector agotó el tiempo de espera.',
};

/** The reason is a code or a free text from the reader; unknown ones are shown as is. */
export const failureLabel = (reason: string | null): string => {
  if (!reason) return 'El enrolamiento no se pudo completar.';
  const known = FAILURE_LABELS[reason];
  return known ?? `Motivo informado por el lector: ${reason}`;
};

export const COMMAND_TYPE_LABELS: Record<string, string> = {
  'alarm.set': 'Alarma',
  'display.message': 'Mensaje en pantalla',
  'enroll.start': 'Enrolamiento',
  'enroll.cancel': 'Cancelar enrolamiento',
  'schedule.set': 'Horario',
  'templates.sync': 'Sincronización de huellas',
};

export const commandTypeLabel = (type: string): string =>
  COMMAND_TYPE_LABELS[type] ?? type;

export const COMMAND_STATUS_LABELS: Record<
  EventOf<'command'>['data']['status'],
  string
> = {
  pending: 'En cola',
  sent: 'Enviada',
  acked: 'Confirmada',
  failed: 'Fallida',
};

export const ALARM_REASON_LABELS: Record<string, string> = {
  END_BEEP: 'Pitido de fin de horario',
  PENDING_EXIT: 'Hay personas que no registraron su salida',
  MANUAL: 'Encendida manualmente',
  TEST: 'Prueba de alarma',
  CLEARED: 'Apagada',
};

export const SOURCE_LABELS = { device: 'Huella', manual: 'Manual' } as const;
