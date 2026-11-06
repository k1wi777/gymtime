import { defaultAuthConfig } from './auth.config.js';
import { SESSION_COOKIE, readCookie, sessionCookieOptions } from './cookie.js';

describe('readCookie', () => {
  it('finds the cookie among others', () => {
    expect(readCookie('a=1; gt_session=abc_-123; b=2', SESSION_COOKIE)).toBe(
      'abc_-123',
    );
  });

  it('is exact on the name', () => {
    expect(readCookie('x_gt_session=1; gt_session2=2', SESSION_COOKIE)).toBe(
      undefined,
    );
  });

  it('handles absent headers, quotes and bad escapes', () => {
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie('gt_session="q"', SESSION_COOKIE)).toBe('q');
    expect(readCookie('gt_session=%E0%A4%A', SESSION_COOKIE)).toBeUndefined();
    expect(readCookie('novalue; gt_session=ok', SESSION_COOKIE)).toBe('ok');
  });
});

describe('sessionCookieOptions (R1, R24)', () => {
  const base = defaultAuthConfig.cookie;

  it('is httpOnly, Strict and host-only by default', () => {
    expect(sessionCookieOptions(base)).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/',
    });
  });

  it('follows the configuration', () => {
    expect(
      sessionCookieOptions({
        domain: '.example.org',
        sameSite: 'None',
        secure: true,
      }),
    ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      domain: '.example.org',
    });
    expect(sessionCookieOptions({ ...base, sameSite: 'Lax' }).sameSite).toBe(
      'lax',
    );
  });
});
