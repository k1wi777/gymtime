import {
  offlineSnapshotPayloadSchema,
  type OfflineEvent,
} from '@gymtime/shared';
import type { z } from 'zod';
import type { LocalState, NewEvent, OfflineQueue } from './offline-queue.js';

export type Snapshot = z.infer<typeof offlineSnapshotPayloadSchema>;

/** Local alarm stops by itself after this long (like the server timeout). */
export const LOCAL_ALARM_TIMEOUT_SEC = 15 * 60;

export type LocalDecision =
  | { result: 'entry' | 'exit'; name: string; event: OfflineEvent }
  | { result: 'unknown'; event: OfflineEvent | null }
  | {
      result: 'reject';
      reason:
        | 'NO_SNAPSHOT'
        | 'NO_SCHEDULE'
        | 'OUTSIDE_WINDOW'
        | 'ALREADY_EXITED'
        | 'QUEUE_FULL';
    };

export function isSnapshot(value: unknown): value is Snapshot {
  return offlineSnapshotPayloadSchema.safeParse(value).success;
}

/**
 * Local decision of the simulated device while it has no connection. These
 * are the reference rules of `docs/modo_sin_conexion_firmware.md`: the
 * snapshot says who may enter and who is inside; the server confirms later
 * with the original `ts`. It never talks to the server.
 */
export class OfflineEngine {
  private alarmStart: number | null = null;

  constructor(private readonly queue: OfflineQueue) {}

  get snapshot(): Snapshot | null {
    const raw = this.queue.state.snapshot;
    return isSnapshot(raw) ? raw : null;
  }

  get alarmActive(): boolean {
    return this.alarmStart !== null;
  }

  /**
   * A new snapshot replaces the roster. `open`/`exited` are taken from it
   * only with an empty queue: otherwise the local state is newer.
   */
  onSnapshot(snapshot: Snapshot): void {
    const keep = this.queue.size > 0;
    this.queue.setState({
      snapshot,
      open: keep ? this.queue.state.open : snapshot.open,
      exited: keep ? this.queue.state.exited : snapshot.exited,
    });
  }

  /** Decides a scan of `slot` at device time `now` (Unix seconds). */
  scan(slot: number, now: number): LocalDecision {
    const snapshot = this.snapshot;
    if (!snapshot) return { result: 'reject', reason: 'NO_SNAPSHOT' };
    if (!snapshot.schedule) return { result: 'reject', reason: 'NO_SCHEDULE' };
    const person = snapshot.roster.find((r) => r.slot === slot);
    if (!person) {
      const event = this.queue.push(
        { type: 'unknown' },
        now,
        snapshot.snapshotId,
      );
      return { result: 'unknown', event };
    }
    const state = this.queue.state;
    if (state.open.includes(slot)) {
      return this.record('exit', slot, person.name, now, snapshot, {
        ...state,
        open: state.open.filter((s) => s !== slot),
        exited: [...state.exited, slot],
      });
    }
    if (state.exited.includes(slot)) {
      return { result: 'reject', reason: 'ALREADY_EXITED' };
    }
    const { entryOpensAt, entryClosesAt } = snapshot.schedule;
    if (now < entryOpensAt || now > entryClosesAt) {
      return { result: 'reject', reason: 'OUTSIDE_WINDOW' };
    }
    return this.record('entry', slot, person.name, now, snapshot, {
      ...state,
      open: [...state.open, slot],
    });
  }

  /**
   * Called periodically while offline: at the end of the schedule with
   * people inside the siren starts; it stops by timeout. Returns a line to
   * show, or null.
   */
  tick(now: number): string | null {
    const schedule = this.snapshot?.schedule;
    if (!schedule) return null;
    if (this.alarmStart === null) {
      if (now >= schedule.end && this.queue.state.open.length > 0) {
        this.alarmStart = schedule.end;
        return 'LOCAL ALARM ON (people still inside)';
      }
      return null;
    }
    if (now - this.alarmStart >= LOCAL_ALARM_TIMEOUT_SEC) {
      return this.endAlarm(
        this.alarmStart + LOCAL_ALARM_TIMEOUT_SEC,
        'timeout',
      );
    }
    return null;
  }

  /** The reader button turns the local siren off. */
  button(now: number): string | null {
    if (this.alarmStart === null) return null;
    return this.endAlarm(now, 'button');
  }

  /**
   * The connection came back while the local siren was on: the server
   * takes over, the event is closed as still sounding (`endTs` null).
   */
  onReconnect(): void {
    const start = this.alarmStart;
    const snapshot = this.snapshot;
    this.alarmStart = null;
    if (start === null || !snapshot) return;
    this.queue.push(
      { type: 'alarm', endTs: null, endedBy: 'timeout' },
      start,
      snapshot.snapshotId,
    );
  }

  private endAlarm(
    endTs: number,
    endedBy: 'button' | 'all_exited' | 'timeout',
  ): string | null {
    const start = this.alarmStart;
    const snapshot = this.snapshot;
    this.alarmStart = null;
    if (start === null || !snapshot) return null;
    const event = this.queue.push(
      { type: 'alarm', endTs, endedBy } satisfies NewEvent,
      start,
      snapshot.snapshotId,
    );
    return event
      ? `LOCAL ALARM OFF (${endedBy})`
      : 'LOCAL ALARM OFF (queue full, alarm event lost)';
  }

  private record(
    type: 'entry' | 'exit',
    slot: number,
    name: string,
    now: number,
    snapshot: Snapshot,
    next: LocalState,
  ): LocalDecision {
    const event = this.queue.push({ type, slot }, now, snapshot.snapshotId);
    if (!event) return { result: 'reject', reason: 'QUEUE_FULL' };
    this.queue.setState({ ...next, snapshot: this.queue.state.snapshot });
    if (this.alarmStart !== null && next.open.length === 0) {
      this.endAlarm(now, 'all_exited');
    }
    return { result: type, name, event };
  }
}
