import { CliError, UsageError } from '../errors.js';
import { HttpError } from '../http.js';
import { noPositionals, required } from './args.js';
import { findStudentByDocument } from './student.js';
import type { Command, CommandContext } from './types.js';

interface Enrollment {
  id: string;
  studentId: string;
  deviceId: string;
  status: string;
  step: string | null;
  failureReason: string | null;
  expiresAt: string;
}

const FINAL_STATUSES = ['done', 'failed', 'expired', 'cancelled'];

/** Operator-facing text for each step the device reports. */
const STEP_TEXT: Record<string, string> = {
  place_finger: 'Place the finger on the reader',
  remove_finger: 'Remove the finger from the reader',
  place_again: 'Place the same finger again',
  processing: 'Processing the fingerprint...',
};

/** Extra wait after `expiresAt` for the server to flag the expiration. */
const EXPIRY_MARGIN_MS = 15_000;
const MAX_POLL_FAILURES = 3;
const EXIT_INTERRUPTED = 130;

const start: Command = {
  group: 'enroll',
  action: 'start',
  summary: 'Enroll the fingerprint of a student, showing live progress',
  usage: 'enroll start --student <document> [--device <deviceId>]',
  options: { student: { type: 'string' }, device: { type: 'string' } },
  async run(ctx) {
    noPositionals(ctx.positionals);
    const document = required(ctx.values['student'], '--student');
    const device = ctx.values['device'];
    if (typeof device === 'string' && device.trim() === '') {
      throw new UsageError('--device must not be empty');
    }

    const student = await findStudentByDocument(ctx.http, document);
    if (!student) throw new CliError(`No student with document ${document}`);
    if (!student.active) {
      throw new CliError(`Student ${document} is inactive and cannot enroll`);
    }

    let enrollment: Enrollment;
    try {
      enrollment = await ctx.http.request<Enrollment>(
        'POST',
        `/students/${student.id}/enrollments`,
        typeof device === 'string' ? { deviceId: device } : {},
      );
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) {
        throw new CliError(`The enrollment was not started. ${error.message}`);
      }
      throw error;
    }
    ctx.io.out(
      `Enrollment ${enrollment.id} started on device ${enrollment.deviceId} (Ctrl+C to cancel).`,
    );
    return follow(ctx, enrollment);
  },
};

const cancel: Command = {
  group: 'enroll',
  action: 'cancel',
  summary: 'Cancel an open enrollment by its id',
  usage: 'enroll cancel <enrollmentId>',
  async run({ http, io, positionals }) {
    const [id, ...extra] = positionals;
    if (id === undefined || extra.length > 0) {
      throw new UsageError('expected exactly one <enrollmentId>');
    }
    const enrollment = await http.request<Enrollment>(
      'POST',
      `/enrollments/${encodeURIComponent(id)}/cancel`,
    );
    io.out(finalText(enrollment));
    return 0;
  },
};

export const enrollCommands: readonly Command[] = [start, cancel];

/** Polls the enrollment until it reaches a final state or is interrupted. */
async function follow(
  ctx: CommandContext,
  initial: Enrollment,
): Promise<number> {
  const deadline = Date.parse(initial.expiresAt) + EXPIRY_MARGIN_MS;
  let current = initial;
  let lastText = '';
  let failures = 0;

  for (;;) {
    const text = describe(current);
    if (text !== lastText) ctx.io.out(text);
    lastText = text;
    if (FINAL_STATUSES.includes(current.status)) return exitCode(current);

    await ctx.sleep(ctx.pollMs, ctx.signal);
    if (ctx.signal.aborted) return interrupt(ctx, current);
    if (ctx.now() > deadline) {
      throw new CliError(
        `Gave up waiting for enrollment ${current.id}: the server did not report an end state`,
      );
    }
    try {
      current = await ctx.http.request<Enrollment>(
        'GET',
        `/enrollments/${current.id}`,
      );
      failures = 0;
    } catch (error) {
      // Tolerate brief network hiccups; an HTTP answer is not transient.
      if (error instanceof HttpError || ++failures > MAX_POLL_FAILURES) {
        throw error;
      }
    }
  }
}

/** Ctrl+C: cancel the open enrollment so the reader returns to normal mode. */
async function interrupt(
  ctx: CommandContext,
  current: Enrollment,
): Promise<number> {
  ctx.io.out('Interrupted, cancelling the enrollment...');
  let latest = current;
  try {
    latest = await ctx.http.request<Enrollment>(
      'POST',
      `/enrollments/${current.id}/cancel`,
    );
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 409)) throw error;
    // Already finished meanwhile: show how it really ended.
    latest = await ctx.http.request<Enrollment>(
      'GET',
      `/enrollments/${current.id}`,
    );
  }
  ctx.io.out(finalText(latest));
  return latest.status === 'done' ? 0 : EXIT_INTERRUPTED;
}

function exitCode(enrollment: Enrollment): number {
  return enrollment.status === 'done' ? 0 : 1;
}

function describe(enrollment: Enrollment): string {
  if (FINAL_STATUSES.includes(enrollment.status)) return finalText(enrollment);
  if (enrollment.step) {
    return STEP_TEXT[enrollment.step] ?? `Device step: ${enrollment.step}`;
  }
  return enrollment.status === 'pending'
    ? 'Waiting for the device to accept the enrollment...'
    : 'Enrollment in progress...';
}

function finalText(enrollment: Enrollment): string {
  switch (enrollment.status) {
    case 'done':
      return 'Done: fingerprint enrolled.';
    case 'failed':
      return `Failed: ${enrollment.failureReason ?? 'unknown reason'}`;
    case 'expired':
      return 'Expired: the device did not complete the enrollment in time.';
    case 'cancelled':
      return 'Cancelled: the enrollment was cancelled.';
    default:
      return `Enrollment is ${enrollment.status}.`;
  }
}
