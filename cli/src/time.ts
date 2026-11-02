/**
 * Display of instants in America/Bogota. Colombia has no daylight saving
 * time, so the zone is a fixed UTC-5 (same assumption as the server).
 */
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

function shifted(iso: string): Date {
  return new Date(Date.parse(iso) + BOGOTA_OFFSET_MS);
}

/** `YYYY-MM-DD HH:mm` of an ISO instant, in Bogota time. */
export function formatBogota(iso: string): string {
  const d = shifted(iso);
  return `${formatBogotaDate(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** `YYYY-MM-DD` of an ISO instant, in Bogota time. */
export function formatBogotaDate(iso: string): string {
  const d = shifted(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `HH:mm:ss` or `HH:mm` of a stored wall-clock time, trimmed to minutes. */
export function shortTime(time: string): string {
  return time.slice(0, 5);
}
