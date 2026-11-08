/**
 * Marks where a new day starts in a list ordered by time: `day` is the label
 * of the day on the first row of each day and null on the rest, so the table
 * can draw one header row per date.
 */
export function withDayHeaders<T>(
  items: readonly T[],
  dayOf: (item: T) => string,
): Array<{ item: T; day: string | null }> {
  let previous: string | null = null;
  return items.map((item) => {
    const day = dayOf(item);
    const starts = day !== previous;
    previous = day;
    return { item, day: starts ? day : null };
  });
}

/** Dot color per kind of event (the part of the code before the dot). */
const DOTS: Record<string, string> = {
  auth: '#0b6a96',
  student: '#3a7a26',
  alarm: '#d4780a',
  attendance: '#0b6f67',
  offline: '#6a4aa8',
  enrollment: '#9b1a45',
};
const OTHER_DOT = '#6b6660';

export const auditDot = (type: string): string =>
  DOTS[type.split('.')[0] ?? ''] ?? OTHER_DOT;
