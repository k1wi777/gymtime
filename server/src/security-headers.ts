import type { NextFunction, Request, Response } from 'express';

/** One year, the usual HSTS value once HTTPS is certain. */
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

/**
 * Headers for a JSON API (no HTML is served, so `helmet`'s extra ones add
 * nothing). HSTS is sent only on requests that arrived over HTTPS (needs
 * `trust proxy` behind a TLS-terminating proxy) and only in production, so a
 * local HTTP development server is never pinned to HTTPS.
 */
export function securityHeaders(options: { production: boolean }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    res.setHeader('X-Frame-Options', 'DENY');
    if (options.production && req.secure) {
      res.setHeader('Strict-Transport-Security', HSTS_VALUE);
    }
    next();
  };
}
