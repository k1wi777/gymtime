/**
 * Content-Security-Policy of the panel (H11, R19), built per request.
 *
 * - Scripts: only the app itself and the ones carrying this request's nonce
 *   ('strict-dynamic' lets those load their own chunks).
 * - Styles keep 'unsafe-inline': Recharts and Next emit `style` attributes,
 *   which a nonce cannot cover. Scripts stay strict.
 * - Connections: the panel and the API (REST and the SSE stream).
 */
export function buildCsp(
  nonce: string,
  apiOrigin: string,
  development = false,
): string {
  const scripts = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // React's debugging features and HMR need eval; never in production.
    ...(development ? ["'unsafe-eval'"] : []),
  ];
  const connect = ["'self'", apiOrigin, ...(development ? ['ws:'] : [])];
  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** Origin (scheme, host, port) of NEXT_PUBLIC_API_URL; the path is not part of a CSP source. */
export function apiOriginOf(raw: string | undefined): string {
  try {
    return new URL((raw ?? '').trim()).origin;
  } catch {
    return '';
  }
}

export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
