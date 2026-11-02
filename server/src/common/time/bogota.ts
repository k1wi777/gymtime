/**
 * Conversions between America/Bogota wall-clock time and UTC instants.
 *
 * Colombia has no daylight saving time, so Bogota is a fixed UTC-5 and no
 * time-zone library is needed. If the project ever leaves Bogota this is the
 * single place to change.
 */
export const BOGOTA_OFFSET_MINUTES = -5 * 60;

const MS_PER_MINUTE = 60_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Wall-clock parts of an instant as seen in Bogota. */
export interface BogotaParts {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm:ss` */
  time: string;
  /** 1 = Monday ... 7 = Sunday */
  weekday: number;
}

/** Shifts an instant so that its UTC fields read as Bogota wall-clock time. */
function shifted(instant: Date): Date {
  return new Date(instant.getTime() + BOGOTA_OFFSET_MINUTES * MS_PER_MINUTE);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toBogotaParts(instant: Date): BogotaParts {
  const s = shifted(instant);
  return {
    date: `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`,
    time: `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}`,
    weekday: s.getUTCDay() === 0 ? 7 : s.getUTCDay(),
  };
}

/** A `YYYY-MM-DD` calendar date shifted by `days`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Weekday (1 = Monday ... 7 = Sunday) of a `YYYY-MM-DD` calendar date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = parseDate(date);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** UTC instant of a Bogota wall-clock date and `HH:mm[:ss]` time. */
export function fromBogota(date: string, time: string): Date {
  const [y, m, d] = parseDate(date);
  const [hh, mm, ss] = parseTime(time);
  const utc = Date.UTC(y, m - 1, d, hh, mm, ss);
  return new Date(utc - BOGOTA_OFFSET_MINUTES * MS_PER_MINUTE);
}

/** `YYYY-MM-DD HH:mm:ss` in Bogota time, for display. */
export function formatBogota(instant: Date): string {
  const p = toBogotaParts(instant);
  return `${p.date} ${p.time}`;
}

/** Seconds since midnight of a `HH:mm[:ss]` string. */
export function secondsOfDay(time: string): number {
  const [hh, mm, ss] = parseTime(time);
  return hh * 3600 + mm * 60 + ss;
}

function parseDate(date: string): [number, number, number] {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`invalid date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseTime(time: string): [number, number, number] {
  const match = TIME_RE.exec(time);
  if (!match) throw new Error(`invalid time: ${time}`);
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}
