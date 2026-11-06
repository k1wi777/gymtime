import type {
  AlarmEvent,
  CloseAlarmEvent,
  NewAlarmEvent,
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
  /** Every event still open (no `endedAt`), oldest first. */
  findOpen(): Promise<AlarmEvent[]>;
  /** The open event of an occurrence, if any. */
  findOpenByInstance(instanceId: string): Promise<AlarmEvent | null>;
  /** Ids, among these occurrences, that have at least one alarm event. */
  instanceIdsWithEvents(instanceIds: string[]): Promise<string[]>;
  /** Alarm history, newest first, with the total for pagination. */
  list(
    filter: AlarmHistoryFilter,
  ): Promise<{ items: AlarmEvent[]; total: number }>;
  /** Closes an event only while it is open; a repeated close is a no-op. */
  close(id: string, data: CloseAlarmEvent): Promise<AlarmEvent | null>;
}

export const ALARM_REPOSITORY = Symbol('ALARM_REPOSITORY');
