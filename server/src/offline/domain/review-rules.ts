import type { OfflineReviewReason } from '@gymtime/shared';
import type { OfflineEventType, OfflineResolution } from './offline-event.js';

/** Reasons a person may approve as they are (design section 7). */
const APPROVABLE_ENTRY: ReadonlySet<OfflineReviewReason> = new Set([
  'OUTSIDE_WINDOW',
  'NOT_IN_SCHEDULE',
  'ALREADY_EXITED',
  'STUDENT_INACTIVE',
  'TS_FUTURE',
  'TS_TOO_OLD',
  'OUT_OF_ORDER',
]);

const APPROVABLE_EXIT: ReadonlySet<OfflineReviewReason> = new Set([
  'SESSION_ALREADY_CLOSED',
  'OUT_OF_ORDER',
  'TS_FUTURE',
  'TS_TOO_OLD',
]);

/** Reasons where the event cannot be rebuilt by changing its hour. */
const NOT_CORRECTABLE: ReadonlySet<OfflineReviewReason> = new Set([
  'UNKNOWN_SNAPSHOT',
  'UNKNOWN_SLOT',
]);

export function canApprove(
  type: OfflineEventType,
  reason: OfflineReviewReason,
): boolean {
  if (type === 'entry') return APPROVABLE_ENTRY.has(reason);
  if (type === 'exit') return APPROVABLE_EXIT.has(reason);
  return false;
}

export function canCorrect(
  type: OfflineEventType,
  reason: OfflineReviewReason,
): boolean {
  return (type === 'entry' || type === 'exit') && !NOT_CORRECTABLE.has(reason);
}

/** Actions the panel may offer for a pending event. Discarding is always valid. */
export function allowedActions(
  type: OfflineEventType,
  reason: OfflineReviewReason | null,
): OfflineResolution[] {
  if (!reason) return [];
  const actions: OfflineResolution[] = [];
  if (canApprove(type, reason)) actions.push('aprobar');
  if (canCorrect(type, reason)) actions.push('corregir');
  actions.push('descartar');
  return actions;
}
