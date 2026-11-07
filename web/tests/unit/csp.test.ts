import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiOriginOf, buildCsp } from '@/lib/csp';
import { proxy } from '@/proxy';

describe('buildCsp (R19)', () => {
  const csp = buildCsp('abc123', 'https://api.example.edu');
  const directive = (name: string) =>
    csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('allows scripts only from the app and with the nonce', () => {
    expect(directive('script-src')).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    );
    expect(csp).not.toContain('unsafe-eval');
  });

  it('keeps unsafe-inline for styles only', () => {
    expect(directive('style-src')).toContain("'unsafe-inline'");
    expect(directive('script-src')).not.toContain('unsafe-inline');
  });

  it('connects only to itself and the API', () => {
    expect(directive('connect-src')).toBe(
      "connect-src 'self' https://api.example.edu",
    );
  });

  it('forbids framing, plugins and foreign bases', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('adds eval and websockets only in development', () => {
    const dev = buildCsp('n', 'http://localhost:3001', true);
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain('ws:');
  });

  it('keeps only the origin of the API URL', () => {
    expect(apiOriginOf('https://api.example.edu/v1/')).toBe(
      'https://api.example.edu',
    );
    expect(apiOriginOf(undefined)).toBe('');
    expect(apiOriginOf('not a url')).toBe('');
  });
});

describe('proxy', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sets a different nonce and the CSP on every response', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.edu');
    const a = proxy(new NextRequest('http://panel.test/login'));
    const b = proxy(new NextRequest('http://panel.test/login'));
    const policy = (r: Response) => r.headers.get('content-security-policy');
    expect(policy(a)).toContain('https://api.example.edu');
    expect(policy(a)).not.toBe(policy(b));
  });

  it('still redirects a visitor without a session to the login, with CSP', () => {
    const res = proxy(new NextRequest('http://panel.test/ahora'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Fahora');
    expect(res.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
  });

  it('lets the login through and a session cookie through', () => {
    expect(proxy(new NextRequest('http://panel.test/login')).status).toBe(200);
    const withCookie = new NextRequest('http://panel.test/ahora', {
      headers: { cookie: 'gt_session=x' },
    });
    expect(proxy(withCookie).status).toBe(200);
  });
});
