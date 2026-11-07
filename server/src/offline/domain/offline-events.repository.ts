import type {
  NewOfflineEvent,
  OfflineEventFilter,
  OfflineEventRecord,
  OfflineOutcome,
  OfflineResolutionData,
  OfflineSettlement,
} from './offline-event.js';

export interface OfflineEventsRepository {
  /**
   * Stores each event as `pendiente` unless that (device, id) already exists;
   * returns the stored record of every input, in order, with `isNew`.
   */
  insertIfAbsent(
    events: NewOfflineEvent[],
  ): Promise<{ record: OfflineEventRecord; isNew: boolean }[]>;
  /** Decides a `pendiente` event; null when it was not pending anymore. */
  settle(
    deviceId: string,
    id: string,
    data: OfflineSettlement,
  ): Promise<OfflineEventRecord | null>;
  findById(deviceId: string, id: string): Promise<OfflineEventRecord | null>;
  /**
   * Latest instant of the student's events already part of the attendance
   * data (`applied`, `aprobado`, `corregido`); null when none.
   */
  lastAppliedTs(studentId: string): Promise<Date | null>;
  /** Oldest `ts` first. */
  list(
    filter?: OfflineEventFilter,
  ): Promise<{ items: OfflineEventRecord[]; total: number }>;
  /** Events grouped by outcome inside the window (counts for the reports). */
  countByOutcome(window: {
    from?: Date;
    to?: Date;
  }): Promise<Partial<Record<OfflineOutcome, number>>>;
  /**
   * Resolves an event only while it is `por_revisar`: true for exactly one of
   * two concurrent callers.
   */
  resolve(
    deviceId: string,
    id: string,
    data: OfflineResolutionData,
  ): Promise<OfflineEventRecord | null>;
}

export const OFFLINE_EVENTS_REPOSITORY = Symbol('OFFLINE_EVENTS_REPOSITORY');
