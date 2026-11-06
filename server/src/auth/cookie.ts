import type { CookieOptions } from 'express';
import type { AuthConfig } from './auth.config.js';

export const SESSION_COOKIE = 'gt_session';

/** Reads one cookie from a `Cookie` header; no signed or JSON cookies are used. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    const quoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
    try {
      return decodeURIComponent(quoted ? raw.slice(1, -1) : raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Attributes of the session cookie. `maxAge` is left out so it can clear it too. */
export function sessionCookieOptions(
  cookie: AuthConfig['cookie'],
): CookieOptions {
  return {
    httpOnly: true,
    secure: cookie.secure,
    sameSite: cookie.sameSite.toLowerCase() as 'strict' | 'lax' | 'none',
    path: '/',
    ...(cookie.domain ? { domain: cookie.domain } : {}),
  };
}
