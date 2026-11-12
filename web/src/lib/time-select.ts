/** Pure helpers of the hour selector (values are `HH:mm`, empty when unset). */

export const HOURS: readonly string[] = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, '0'),
);

export const MINUTE_STEP = 5;

export const MINUTES: readonly string[] = Array.from(
  { length: 60 / MINUTE_STEP },
  (_, i) => String(i * MINUTE_STEP).padStart(2, '0'),
);

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isTime = (value: string): boolean => TIME.test(value);

export function parseTime(
  value: string,
): { hour: string; minute: string } | undefined {
  const match = TIME.exec(value);
  return match?.[1] && match[2]
    ? { hour: match[1], minute: match[2] }
    : undefined;
}

export const joinTime = (hour: string, minute: string): string =>
  `${hour}:${minute}`;

/**
 * Minutes offered: every fifth one, plus the current minute when it is not a
 * multiple of five (an existing 18:07 is shown and kept, never rounded).
 */
export function minuteOptions(selectedMinute?: string): readonly string[] {
  if (!selectedMinute || MINUTES.includes(selectedMinute)) return MINUTES;
  return [...MINUTES, selectedMinute].sort();
}
