import type { DisplayFieldError } from '@gymtime/shared';

/** The message does not fit the reader screen; `errors` say which field and why. */
export class DisplayValidationError extends Error {
  constructor(readonly errors: DisplayFieldError[]) {
    super(errors.map((error) => error.message).join('; '));
  }
}
