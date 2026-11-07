import type { TsLimits } from './domain/reconcile.js';

export interface OfflineConfig {
  /** Limits of an event instant against the server clock (R11). */
  limits: TsLimits;
  /** Seconds the snapshot waits for a reconnecting reader's queue (R4). */
  snapshotWaitSec: number;
  /** Days a snapshot is kept to resolve late events. */
  retentionDays: number;
}

export const OFFLINE_CONFIG = Symbol('OFFLINE_CONFIG');

/** Nothing before this is a plausible attendance instant. */
export const MIN_EVENT_TS = new Date('2020-01-01T00:00:00Z');

export const defaultOfflineConfig: OfflineConfig = {
  limits: {
    futureToleranceSec: 120,
    maxAgeSec: 72 * 3600,
    minTs: MIN_EVENT_TS,
  },
  snapshotWaitSec: 60,
  retentionDays: 14,
};
