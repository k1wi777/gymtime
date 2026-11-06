import type { PasswordProblem } from './password-policy.js';

/** Single answer for every failed sign-in: it never says which part failed. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
  }
}

export class LoginRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many sign-in attempts');
  }
}

export class PasswordPolicyError extends Error {
  constructor(readonly problem: PasswordProblem | 'same_as_current') {
    super(`Password rejected: ${problem}`);
  }
}

export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super('The current password is wrong');
  }
}
