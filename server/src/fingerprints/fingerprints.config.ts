import { SLOT_MAX } from '@gymtime/shared';

export interface FingerprintsConfig {
  /** Reader slot used as scratch space while enrolling; sync uses 1..N below it. */
  enrollSlot: number;
  /** Time the reader gets to complete an enrollment. */
  enrollTimeoutSec: number;
  /** Extra time before expiry to cover the ack of `enroll.start`. */
  ackMarginSec: number;
  /** Expected decoded template size; the backlog says "~512" for the AS608. */
  expectedTemplateBytes: number;
  /** Allowed deviation from the expected size if the real reader differs. */
  templateToleranceBytes: number;
  /** Interval of the expiry sweep. */
  expirySweepMs: number;
}

export const FINGERPRINTS_CONFIG = Symbol('FINGERPRINTS_CONFIG');

export const defaultFingerprintsConfig: FingerprintsConfig = {
  enrollSlot: SLOT_MAX,
  enrollTimeoutSec: 60,
  ackMarginSec: 15,
  expectedTemplateBytes: 512,
  templateToleranceBytes: 0,
  expirySweepMs: 5000,
};
