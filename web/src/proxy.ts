import { NextResponse, type NextRequest } from 'next/server';
import { apiOriginOf, buildCsp, newNonce } from './lib/csp';

/** Name of the session cookie set by the API. */
export const SESSION_COOKIE = 'gt_session';

/** Pages a visitor without a session may open. */
const PUBLIC_PATHS = ['/login'];

/**
 * Two jobs on every page request:
 *  1. Content-Security-Policy with a fresh nonce (Next reads it from the
 *     request header and stamps its own scripts with it).
 *  2. A visitor without the session cookie goes straight to the login. It does
 *     NOT validate the cookie: it may be stale and the API (`GET /auth/me`) is
 *     the authority, which every screen consults.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = newNonce();
  const csp = buildCsp(
    nonce,
    apiOriginOf(process.env.NEXT_PUBLIC_API_URL),
    process.env.NODE_ENV !== 'production',
  );

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
  let response: NextResponse;
  if (isPublic || request.cookies.has(SESSION_COOKIE)) {
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    headers.set('Content-Security-Policy', csp);
    response = NextResponse.next({ request: { headers } });
  } else {
    const url = request.nextUrl.clone();
    const target = path + request.nextUrl.search;
    url.pathname = '/login';
    url.search = '';
    if (target !== '/') url.searchParams.set('next', target);
    response = NextResponse.redirect(url);
  }
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Pages only: not Next's own files, the favicon or anything with an extension.
  matcher: ['/((?!_next/|favicon.ico|.*\\..*).*)'],
};
