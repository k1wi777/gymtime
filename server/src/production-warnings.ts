import type { Env } from './config/env.schema.js';

/**
 * Misconfigurations that are valid but suspicious in production. They are
 * warnings, never errors: a direct deployment without a proxy is legitimate.
 */
export function productionWarnings(
  env: Pick<
    Env,
    | 'NODE_ENV'
    | 'TRUST_PROXY'
    | 'COOKIE_DOMAIN'
    | 'CORS_ORIGINS'
    | 'DEVICE_TOKEN'
  >,
): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const warnings: string[] = [];
  if (env.TRUST_PROXY === 0) {
    warnings.push(
      'TRUST_PROXY=0: behind a reverse proxy the sign-in limiter sees only the proxy IP and HTTPS requests are not recognised; set the number of proxy hops',
    );
  }
  if (!env.COOKIE_DOMAIN) {
    warnings.push(
      'COOKIE_DOMAIN is empty: the session cookie is host-only; set it if the panel and the API live on sibling subdomains',
    );
  }
  if (env.CORS_ORIGINS.length === 0) {
    warnings.push(
      'CORS_ORIGINS is empty: no browser origin can call the API; list the panel origin',
    );
  }
  if (env.DEVICE_TOKEN) {
    warnings.push(
      'DEVICE_TOKEN is set: the shared token is a transition; when you register the real reader (gym device register) remove DEVICE_TOKEN and restart, so no reader can connect with a shared secret',
    );
  }
  return warnings;
}
