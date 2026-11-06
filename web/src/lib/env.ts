/**
 * Base URL of the API, baked into the bundle at build time. The reference has
 * to be the literal `process.env.NEXT_PUBLIC_API_URL` for Next to inline it.
 */
export function resolveApiUrl(raw: string | undefined): string {
  if (!raw || raw.trim() === '') {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set. Copy web/.env.example to web/.env.local (for example NEXT_PUBLIC_API_URL=http://localhost:3001).',
    );
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`NEXT_PUBLIC_API_URL is not a valid URL: "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_API_URL must start with http:// or https://');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

export function apiUrl(): string {
  return resolveApiUrl(process.env.NEXT_PUBLIC_API_URL);
}
