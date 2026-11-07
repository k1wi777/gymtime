import type {
  AlarmEvent,
  CloseAlarmEvent,
  NewAlarmEvent,
  NewLocalAlarmEvent,
} from './alarm-event.js';

export interface AlarmHistoryFilter {
  /** Inclusive bounds of `startedAt`. */
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface AlarmRepository {
  create(data: NewAlarmEvent): Promise<AlarmEvent>;
  /**
   * Stores a local alarm; returns the existing row, flagged, when that reader
   * event was already stored.
   */
  createLocal(
    data: NewLocalAlarmEvent,
  ): Promise<{ event: AlarmEvent; created: boolean }>;
  /** Every server event still open (no `endedAt`), oldest first. */
  findOpen(): Promise<AlarmEvent[]>;
  /** The open server event of an occurrence, if any. */
  findOpenByInstance(instanceId: string): Promise<AlarmEvent | null>;
  /** Ids, among these occurrences, that have at least one alarm event. */
  instanceIdsWithEvents(instanceIds: string[]): Promise<string[]>;
  /** Every event of these occurrences, oldest first. */
  findByInstanceIds(instanceIds: string[]): Promise<AlarmEvent[]>;
  /** Alarm history, newest first, with the total for pagination. */
  list(
    filter: AlarmHistoryFilter,
  ): Promise<{ items: AlarmEvent[]; total: number }>;
  /** Closes an event only while it is open; a repeated close is a no-op. */
  close(id: string, data: CloseAlarmEvent): Promise<AlarmEvent | null>;
}

export const ALARM_REPOSITORY = Symbol('ALARM_REPOSITORY');
