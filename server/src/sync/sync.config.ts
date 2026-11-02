export interface SyncConfig {
  /** Minutes before a schedule starts when its templates are loaded (SYNC_LEAD_MINUTES). */
  leadMinutes: number;
  /** Templates per `templates.sync` message; the protocol caps it at 10. */
  chunkSize: number;
  /** Extra attempts of a chunk after OutboundSender gave up on it. */
  chunkRetries: number;
  /** Interval of the trigger scheduler. */
  tickMs: number;
}

export const SYNC_CONFIG = Symbol('SYNC_CONFIG');

export const defaultSyncConfig: Omit<SyncConfig, 'leadMinutes'> = {
  chunkSize: 10,
  chunkRetries: 2,
  tickMs: 10_000,
};
