import type { Request } from 'express';
import {
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
} from '../common/auth/auth-context.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const isMutation = (method: string): boolean =>
  MUTATING_METHODS.has(method.toUpperCase());

export type CsrfFailure = 'missing_client_header' | 'bad_origin';

/**
 * CSRF defence for requests that rely on the browser's cookie: a mutation
 * must carry the custom `x-gymtime-client` header (a cross-site form cannot
 * send it and `fetch` needs a CORS preflight that only listed origins pass)
 * and an `Origin` that is exactly one of CORS_ORIGINS. Reads are not mutations
 * and need nothing. Returns the failure, or null when the request may go on.
 */
export function checkCsrf(
  request: Pick<Request, 'method' | 'headers'>,
  allowedOrigins: readonly string[],
): CsrfFailure | null {
  if (!isMutation(request.method)) return null;
  if (request.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE) {
    return 'missing_client_header';
  }
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) {
    return 'bad_origin';
  }
  return null;
}
