import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison that does not leak the length. */
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}
