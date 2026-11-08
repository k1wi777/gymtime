/**
 * Every date and time shown by the panel goes through here, always in
 * America/Bogota, whatever the zone of the browser. Screens must not call
 * `toLocale*` or `Intl.DateTimeFormat` themselves.
 */
export const TIME_ZONE = 'America/Bogota';
const LOCALE = 'es-CO';

const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const timeSecondsFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const isoDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const toDate = (value: string | Date): Date =>
  typeof value === 'string' ? new Date(value) : value;

/** `14:05` */
export const formatTime = (value: string | Date): string =>
  timeFormat.format(toDate(value));

/** `14:05:09` */
export const formatTimeSeconds = (value: string | Date): string =>
  timeSecondsFormat.format(toDate(value));

/** `lun, 02 nov 2026` */
export const formatDate = (value: string | Date): string =>
  dateFormat.format(toDate(value));

/** `lun, 02 nov 2026, 14:05` */
export const formatDateTime = (value: string | Date): string =>
  `${formatDate(value)}, ${formatTime(value)}`;

/** The Bogota calendar day of an instant, as `YYYY-MM-DD`. */
export const bogotaDay = (value: string | Date): string =>
  isoDayFormat.format(toDate(value));

/** A `YYYY-MM-DD` day (already a Bogota day) shown as a long date. */
export function formatDay(day: string): string {
  // Noon avoids any edge: the day is the same in every zone near Bogota.
  return formatDate(new Date(`${day}T12:00:00-05:00`));
}

/** Seconds as `m:ss`, or `h:mm:ss` from one hour on. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const longDayFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** `lunes 2 de noviembre` */
export const formatLongDay = (value: string | Date): string =>
  longDayFormat.format(toDate(value)).replace(',', '');

const shortDayFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
});

/** `7 sept`: a `YYYY-MM-DD` day without weekday or year. */
export const formatShortDay = (day: string): string =>
  shortDayFormat.format(new Date(`${day}T12:00:00-05:00`)).replace(' de ', ' ');
