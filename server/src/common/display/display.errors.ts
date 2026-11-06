import type { DisplayLineError } from '@gymtime/shared';

/** The lines do not fit the reader screen; `errors` say which and why. */
export class DisplayValidationError extends Error {
  constructor(readonly errors: DisplayLineError[]) {
    super(errors.map((error) => error.message).join('; '));
  }
}
