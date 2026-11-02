import { randomBytes } from 'node:crypto';
import { ENROLL_STEPS } from '@gymtime/shared';

export const ENROLL_MODES = ['ok', 'fail', 'silent'] as const;
export type EnrollMode = (typeof ENROLL_MODES)[number];

export interface EnrollmentOptions {
  mode: EnrollMode;
  /** Pause before each step and before the final result. */
  stepMs: number;
  failReason: string;
  /** Decoded size of the fake template; the server expects 512. */
  templateBytes: number;
}

export const DEFAULT_ENROLLMENT: EnrollmentOptions = {
  mode: 'ok',
  stepMs: 800,
  failReason: 'simulated_failure',
  templateBytes: 512,
};

export type EnrollmentEmit = (
  type: 'enroll.progress' | 'enroll.done' | 'enroll.failed',
  payload: Record<string, unknown>,
) => void;

/**
 * Plays the device side of an enrollment: one `enroll.progress` per step and
 * then `enroll.done` (or `enroll.failed`). Decoupled from the socket so it
 * can be tested with fake timers; it never logs templates.
 */
export class EnrollmentSimulator {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly emit: EnrollmentEmit,
    private readonly options: EnrollmentOptions,
    private readonly log: (text: string) => void = () => undefined,
  ) {}

  start({ enrollmentId }: { enrollmentId: string }): void {
    if (this.options.mode === 'silent') {
      this.log(`silent mode: ignoring enroll.start ${enrollmentId}`);
      return;
    }
    // A repeated start of the running enrollment is ignored; a different one
    // replaces it, as the single reader slot can only serve one.
    if (this.timers.has(enrollmentId)) return;
    this.stop();
    const actions =
      this.options.mode === 'fail'
        ? [
            this.progress(enrollmentId, ENROLL_STEPS[0]),
            this.fail(enrollmentId),
          ]
        : [
            ...ENROLL_STEPS.map((step) => this.progress(enrollmentId, step)),
            this.done(enrollmentId),
          ];
    this.schedule(enrollmentId, actions);
  }

  cancel({ enrollmentId }: { enrollmentId: string }): void {
    const timer = this.timers.get(enrollmentId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(enrollmentId);
    this.log(`enrollment ${enrollmentId} cancelled, stopping steps`);
  }

  /** Drops every pending step (used when the client stops or disconnects). */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private schedule(id: string, actions: (() => void)[], index = 0): void {
    const action = actions[index];
    if (!action) {
      this.timers.delete(id);
      return;
    }
    const timer = setTimeout(() => {
      action();
      this.schedule(id, actions, index + 1);
    }, this.options.stepMs);
    this.timers.set(id, timer);
  }

  private progress(enrollmentId: string, step: string): () => void {
    return () => this.emit('enroll.progress', { enrollmentId, step });
  }

  private fail(enrollmentId: string): () => void {
    return () =>
      this.emit('enroll.failed', {
        enrollmentId,
        reason: this.options.failReason,
      });
  }

  private done(enrollmentId: string): () => void {
    return () =>
      // Random per enrollment so two simulated students never share a print.
      this.emit('enroll.done', {
        enrollmentId,
        template: randomBytes(this.options.templateBytes).toString('base64'),
      });
  }
}
