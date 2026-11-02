/** One dated occurrence of a schedule. */
export interface ScheduleInstance {
  id: string;
  scheduleId: string;
  /** Bogota calendar date, `YYYY-MM-DD`. */
  date: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

export type NewScheduleInstance = Omit<ScheduleInstance, 'id' | 'status'>;
