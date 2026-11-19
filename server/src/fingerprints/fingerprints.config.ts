import { SLOT_MAX } from '@gymtime/shared';

export interface FingerprintsConfig {
  /** Reader slot used as scratch space while enrolling; sync uses 1..N below it. */
  enrollSlot: number;
  /** Time the reader gets to complete an enrollment. */
  enrollTimeoutSec: number;
  /** Extra time before expiry to cover the ack of `enroll.start`. */
  ackMarginSec: number;
  /** Minimum decoded template size (legacy/simulated templates are 512 B). */
  minTemplateBytes: number;
  /** Maximum decoded template size: the real AS608 delivers 768 B (6 x 128 B) and the firmware buffer is 768 B. */
  maxTemplateBytes: number;
  /** Interval of the expiry sweep. */
  expirySweepMs: number;
}

export const FINGERPRINTS_CONFIG = Symbol('FINGERPRINTS_CONFIG');

export const defaultFingerprintsConfig: FingerprintsConfig = {
  enrollSlot: SLOT_MAX,
  enrollTimeoutSec: 60,
  ackMarginSec: 15,
  minTemplateBytes: 512,
  maxTemplateBytes: 768,
  expirySweepMs: 5000,
};
