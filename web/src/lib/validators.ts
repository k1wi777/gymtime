import {
  DISPLAY_SUBTITLE_LINES,
  DISPLAY_SUBTITLE_MAX,
  DISPLAY_TITLE_MAX,
  DISPLAY_TONES,
  type DisplayTone,
} from './display';

/** Pure validators: the server stays the authority, these only give early feedback. */
export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export interface LoginValues {
  username: string;
  password: string;
}

export function validateLogin(values: LoginValues): FieldErrors<LoginValues> {
  const errors: FieldErrors<LoginValues> = {};
  if (values.username.trim() === '') errors.username = 'Escriba el usuario.';
  if (values.password === '') errors.password = 'Escriba la contraseña.';
  return errors;
}

export interface PasswordValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function validatePasswordChange(
  values: PasswordValues,
): FieldErrors<PasswordValues> {
  const errors: FieldErrors<PasswordValues> = {};
  if (values.currentPassword === '') {
    errors.currentPassword = 'Escriba la contraseña actual.';
  }
  const length = Array.from(values.newPassword).length;
  if (length < PASSWORD_MIN) {
    errors.newPassword = `La nueva contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  } else if (length > PASSWORD_MAX) {
    errors.newPassword = `La nueva contraseña admite hasta ${PASSWORD_MAX} caracteres.`;
  } else if (values.newPassword === values.currentPassword) {
    errors.newPassword = 'La nueva contraseña debe ser distinta de la actual.';
  }
  if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = 'Las contraseñas no coinciden.';
  }
  return errors;
}

export interface ManualValues {
  studentId: string;
  reason: string;
}

export const REASON_MAX = 500;

export function validateManual(
  values: ManualValues,
): FieldErrors<ManualValues> {
  const errors: FieldErrors<ManualValues> = {};
  if (values.studentId === '') errors.studentId = 'Elija un estudiante.';
  if (values.reason.trim() === '') {
    errors.reason = 'El motivo es obligatorio.';
  } else if (values.reason.trim().length > REASON_MAX) {
    errors.reason = `El motivo admite hasta ${REASON_MAX} caracteres.`;
  }
  return errors;
}

export interface MessageValues {
  title: string;
  subtitle: string;
  tone: string;
  seconds: string;
}

export function validateMessage(
  values: MessageValues,
): FieldErrors<MessageValues> {
  const errors: FieldErrors<MessageValues> = {};
  const title = values.title.trim();
  if (title === '') errors.title = 'El título es obligatorio.';
  else if (title.length > DISPLAY_TITLE_MAX)
    errors.title = `Máximo ${DISPLAY_TITLE_MAX} caracteres (lleva ${title.length}).`;
  else if (/\n/.test(title)) errors.title = 'El título es de una sola línea.';
  const subtitle = values.subtitle.trim();
  const lines = subtitle === '' ? 0 : subtitle.split('\n').length;
  if (subtitle.length > DISPLAY_SUBTITLE_MAX)
    errors.subtitle = `Máximo ${DISPLAY_SUBTITLE_MAX} caracteres (lleva ${subtitle.length}).`;
  else if (lines > DISPLAY_SUBTITLE_LINES)
    errors.subtitle = `Máximo ${DISPLAY_SUBTITLE_LINES} líneas (lleva ${lines}).`;
  if (!DISPLAY_TONES.includes(values.tone as DisplayTone))
    errors.tone = 'Elija un tipo de mensaje.';
  if (values.seconds.trim() !== '') {
    const seconds = Number(values.seconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60)
      errors.seconds = 'Los segundos son un número entero de 1 a 60.';
  }
  return errors;
}

/** A redirect target is only accepted when it stays inside the panel. */
export function safeNext(
  next: string | null | undefined,
  fallback = '/ahora',
): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback;
  if (next.startsWith('/login') || next.startsWith('/\\')) return fallback;
  return next;
}
