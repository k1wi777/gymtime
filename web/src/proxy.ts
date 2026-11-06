import { NextResponse, type NextRequest } from 'next/server';

/** Name of the session cookie set by the API. */
export const SESSION_COOKIE = 'gt_session';

/**
 * Only checks that the session cookie exists, so a visitor without one goes
 * straight to the login. It does NOT validate it: the cookie may be stale and
 * the API (`GET /auth/me`) is the authority, which every screen consults.
 */
export function proxy(request: NextRequest): NextResponse {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  const target = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = '/login';
  url.search = '';
  if (target !== '/') url.searchParams.set('next', target);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login, Next's own files and static assets.
  matcher: ['/((?!login|_next/|favicon.ico|.*\\..*).*)'],
};
