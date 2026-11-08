import type { Period } from '@/api/types';

const DAY_MS = 86_400_000;

const dayNumber = (day: string): number =>
  Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

export interface TimelineMark {
  id: string;
  title: string;
  /** Percent from the start of the period. */
  left: number;
  /** Percent width of a range; null for a single day (drawn as a thin tick). */
  width: number | null;
}

export interface Timeline {
  /** Percent of the period elapsed at `today` (0 before it, 100 after it). */
  progress: number;
  /** Position of «Hoy», or null when today is outside the period. */
  todayAt: number | null;
  marks: TimelineMark[];
}

/**
 * Positions for the period line: elapsed part, today and the days without
 * service, proportional to the days of the period (both ends included).
 */
export function periodTimeline(
  period: Pick<Period, 'startDate' | 'endDate' | 'exceptions'>,
  today: string,
): Timeline {
  const start = dayNumber(period.startDate);
  const total = Math.max(1, dayNumber(period.endDate) - start + 1);
  const at = (day: string) => ((dayNumber(day) - start) / total) * 100;
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  const marks: TimelineMark[] = [];
  for (const exception of period.exceptions) {
    if (exception.to < period.startDate || exception.from > period.endDate) {
      continue;
    }
    const left = clamp(at(exception.from));
    marks.push({
      id: exception.id,
      title: exception.reason,
      left,
      width:
        exception.from === exception.to
          ? null
          : clamp(
              ((dayNumber(exception.to) - dayNumber(exception.from) + 1) /
                total) *
                100,
            ),
    });
  }
  const inside = today >= period.startDate && today <= period.endDate;
  return {
    progress: today < period.startDate ? 0 : inside ? clamp(at(today)) : 100,
    todayAt: inside ? clamp(at(today)) : null,
    marks,
  };
}
