import type { ServerMessage } from '@gymtime/shared';

type Payload<T extends ServerMessage['type']> = Extract<
  ServerMessage,
  { type: T }
>['payload'];

export type SyncPayload = Payload<'templates.sync'>;
export type SchedulePayload = Payload<'schedule.set'>;

export interface SyncOutcome {
  /** Slots stored by this chunk, ascending. */
  slots: number[];
  /** Templates held by the reader after this chunk. */
  total: number;
  /** True when this chunk started a new sync and wiped the reader first. */
  cleared: boolean;
}

/**
 * Fingerprint memory of the simulated reader (the AS608 side). It holds the
 * templates loaded by `templates.sync` and the schedule from `schedule.set`.
 * Pure state, no sockets; it exposes slots and counts but never lets a
 * template reach a log (callers get only the `SyncOutcome`).
 */
export class ReaderSimulator {
  private readonly templates = new Map<number, string>();
  private syncId: string | null = null;
  private schedule: SchedulePayload | null = null;

  /** Number of templates stored: the `status.fingerprintCount`. */
  get count(): number {
    return this.templates.size;
  }

  get currentSchedule(): SchedulePayload | null {
    return this.schedule;
  }

  /** Slots in use, ascending (diagnostics; no template content). */
  get slots(): number[] {
    return [...this.templates.keys()].sort((a, b) => a - b);
  }

  /** Template stored in a slot (for tests and the future scan simulation). */
  templateAt(slot: number): string | undefined {
    return this.templates.get(slot);
  }

  /**
   * A new `syncId` wipes everything first, as the firmware must do at the
   * first chunk. A chunk of the same sync only adds (a retried chunk
   * overwrites its own slots, so it is idempotent).
   */
  onSync(payload: SyncPayload): SyncOutcome {
    const cleared = payload.syncId !== this.syncId;
    if (cleared) {
      this.templates.clear();
      this.syncId = payload.syncId;
    }
    for (const { slot, template } of payload.templates) {
      this.templates.set(slot, template);
    }
    return {
      slots: payload.templates.map((t) => t.slot).sort((a, b) => a - b),
      total: this.templates.size,
      cleared,
    };
  }

  onSchedule(payload: SchedulePayload): void {
    this.schedule = { ...payload };
  }
}

const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

/** `YYYY-MM-DD HH:mm:ss` of a Unix-seconds instant in Bogota time (fixed UTC-5). */
export function formatBogota(unixSeconds: number): string {
  const shifted = new Date(unixSeconds * 1000 + BOGOTA_OFFSET_MS);
  return shifted.toISOString().slice(0, 19).replace('T', ' ');
}

/** Operator-facing line for a stored schedule, in Bogota time. */
export function describeSchedule(schedule: SchedulePayload): string {
  return (
    `schedule ${schedule.scheduleId}: ${formatBogota(schedule.start)} to ` +
    `${formatBogota(schedule.end).slice(11)}, entry ` +
    `${formatBogota(schedule.entryOpensAt).slice(11)} to ` +
    `${formatBogota(schedule.entryClosesAt).slice(11)} (Bogota)`
  );
}
