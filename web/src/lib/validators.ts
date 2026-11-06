import { DISPLAY_LINE_MAX } from './display';

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
  line1: string;
  line2: string;
}

export function validateMessage(
  values: MessageValues,
): FieldErrors<MessageValues> {
  const errors: FieldErrors<MessageValues> = {};
  if (values.line1.trim() === '')
    errors.line1 = 'La primera línea es obligatoria.';
  for (const key of ['line1', 'line2'] as const) {
    if (values[key].length > DISPLAY_LINE_MAX) {
      errors[key] =
        `Máximo ${DISPLAY_LINE_MAX} caracteres (lleva ${values[key].length}).`;
    }
  }
  return errors;
}

/** A redirect target is only accepted when it stays inside the panel. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/ahora';
  if (next.startsWith('/login') || next.startsWith('/\\')) return '/ahora';
  return next;
}
