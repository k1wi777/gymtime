import type { OfflineReviewReason } from '@gymtime/shared';

/**
 * What the server did with an event of a reader's offline queue. `pendiente`
 * is internal: saved but not decided yet (a crash left it so; a re-send
 * processes it again).
 */
export type OfflineOutcome =
  | 'pendiente'
  | 'applied'
  | 'por_revisar'
  | 'aprobado'
  | 'corregido'
  | 'descartado'
  | 'informativo'
  | 'invalido';

export const OFFLINE_OUTCOMES: readonly OfflineOutcome[] = [
  'pendiente',
  'applied',
  'por_revisar',
  'aprobado',
  'corregido',
  'descartado',
  'informativo',
  'invalido',
];

export type OfflineEventType = 'entry' | 'exit' | 'unknown' | 'alarm';
export type OfflineResolution = 'aprobar' | 'corregir' | 'descartar';

/** Outcomes that mean "the event's effect is part of the attendance data". */
export const APPLIED_OUTCOMES: readonly OfflineOutcome[] = [
  'applied',
  'aprobado',
  'corregido',
];

export interface OfflineEventRecord {
  deviceId: string;
  /** Event id made by the device: with `deviceId`, the idempotency key. */
  id: string;
  seq: number;
  ts: Date;
  type: OfflineEventType;
  slot: number | null;
  snapshotId: string | null;
  batchId: string | null;
  studentId: string | null;
  instanceId: string | null;
  outcome: OfflineOutcome;
  reviewReason: OfflineReviewReason | null;
  sessionId: string | null;
  alarmEventId: string | null;
  receivedAt: Date;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolution: OfflineResolution | null;
  resolutionNote: string | null;
  correctedTs: Date | null;
}

/** The part of a record the batch handler supplies when it first stores it. */
export type NewOfflineEvent = Pick<
  OfflineEventRecord,
  'deviceId' | 'id' | 'seq' | 'ts' | 'type' | 'slot' | 'snapshotId' | 'batchId'
> & { receivedAt: Date };

/** What deciding an event fills in. */
export interface OfflineSettlement {
  outcome: OfflineOutcome;
  reviewReason?: OfflineReviewReason | null;
  studentId?: string | null;
  instanceId?: string | null;
  sessionId?: string | null;
  alarmEventId?: string | null;
}

export interface OfflineResolutionData {
  outcome: Extract<OfflineOutcome, 'aprobado' | 'corregido' | 'descartado'>;
  resolution: OfflineResolution;
  resolvedBy: string | null;
  resolvedAt: Date;
  resolutionNote: string;
  correctedTs?: Date | null;
  sessionId?: string | null;
  studentId?: string | null;
  instanceId?: string | null;
}

export interface OfflineEventFilter {
  /** Event id made by the device (unique in practice across devices). */
  id?: string;
  outcomes?: OfflineOutcome[];
  studentId?: string;
  /** Inclusive bounds of `ts`. */
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}
