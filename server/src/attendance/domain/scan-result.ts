import { randomUUID } from 'node:crypto';
import type { ServerMessage } from '@gymtime/shared';
import type { Student } from '../../students/domain/student.js';
import type { Decision } from './decision.js';
import {
  UNKNOWN_DISPLAY,
  deniedDisplay,
  entryDisplay,
  exitDisplay,
} from './display.js';

export type ScanResultMessage = Extract<ServerMessage, { type: 'scan.result' }>;

/**
 * Builds the response to a scan: `ref` is the scan id, `ts` the server instant
 * of the decision (the device timestamp is never echoed as the decision time).
 */
export function buildScanResult(
  decision: Decision,
  student: Student | null,
  ref: string,
  at: Date,
): ScanResultMessage {
  const envelope = {
    v: 1 as const,
    id: randomUUID(),
    type: 'scan.result' as const,
    ts: seconds(at),
    ref,
  };
  if (decision.kind === 'denied') {
    return {
      ...envelope,
      payload: {
        result: 'denied',
        studentName: student?.name ?? null,
        reason: decision.reason,
        display: deniedDisplay(decision.reason, student?.name ?? null),
      },
    };
  }
  const name = requireName(student);
  const display =
    decision.kind === 'entry' ? entryDisplay(name) : exitDisplay(name);
  return {
    ...envelope,
    payload: { result: decision.kind, studentName: name, reason: null, display },
  };
}

export function buildUnknownScanResult(
  ref: string,
  at: Date,
): ScanResultMessage {
  return {
    v: 1,
    id: randomUUID(),
    type: 'scan.result',
    ts: seconds(at),
    ref,
    payload: {
      result: 'unknown',
      studentName: null,
      reason: null,
      display: UNKNOWN_DISPLAY,
    },
  };
}

/** `entry`/`exit` always come from a resolved student. */
function requireName(student: Student | null): string {
  if (!student) throw new Error('entry/exit decisions require a student');
  return student.name;
}

const seconds = (at: Date) => Math.floor(at.getTime() / 1000);
