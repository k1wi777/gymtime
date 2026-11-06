export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = 'too_short' | 'too_long' | 'same_as_username';

/**
 * Password rules of the panel accounts. The length is counted in characters,
 * not bytes. Returns the first problem found, or `null` when it is acceptable.
 * "Same as the current password" needs the stored hash and is checked by the
 * service that changes the password.
 */
export function checkPassword(
  password: string,
  username: string,
): PasswordProblem | null {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (length > PASSWORD_MAX_LENGTH) return 'too_long';
  if (password.toLowerCase() === username.trim().toLowerCase()) {
    return 'same_as_username';
  }
  return null;
}

export const PASSWORD_PROBLEM_MESSAGE: Record<PasswordProblem, string> = {
  too_short: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`,
  too_long: `La contraseña no puede superar ${PASSWORD_MAX_LENGTH} caracteres`,
  same_as_username: 'La contraseña no puede ser igual al usuario',
};
