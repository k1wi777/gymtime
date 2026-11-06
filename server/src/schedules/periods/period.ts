/** Academic period: a range of Bogota dates (inclusive) that groups schedules. */
export interface Period {
  id: string;
  name: string;
  /** `YYYY-MM-DD` */
  startDate: string;
  /** `YYYY-MM-DD`, never before `startDate`. */
  endDate: string;
  /** At most one period is active at a time. */
  active: boolean;
}

export interface NewPeriod {
  name: string;
  startDate: string;
  endDate: string;
}

/** A range of days (inclusive) without service inside a period. */
export interface ServiceException {
  id: string;
  periodId: string;
  from: string;
  to: string;
  reason: string;
}

export interface NewServiceException {
  periodId: string;
  from: string;
  to: string;
  reason: string;
}

export type PeriodErrorCode =
  | 'PERIOD_NOT_FOUND'
  | 'EXCEPTION_NOT_FOUND'
  | 'PERIOD_OVERLAP'
  | 'PERIOD_HAS_SCHEDULES'
  | 'INVALID_RANGE'
  | 'EXCEPTION_OUT_OF_PERIOD'
  | 'PERIOD_EXCLUDES_EXCEPTION';

/** Business-rule failure of the periods; the controller maps `code` to HTTP. */
export class PeriodError extends Error {
  constructor(
    readonly code: PeriodErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const rangesOverlap = (
  a: { from: string; to: string },
  b: { from: string; to: string },
): boolean => a.from <= b.to && b.from <= a.to;
