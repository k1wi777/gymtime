import { z } from 'zod';
import {
  nonEmptyStringSchema,
  slotSchema,
  unixSecondsSchema,
  uuidSchema,
} from './envelope.js';

/** Optional capabilities a device declares in `hello` (H12). */
export const DEVICE_CAPABILITIES = ['offline'] as const;
export const deviceCapabilitySchema = z.enum(DEVICE_CAPABILITIES);

/** Events the device may keep while it has no connection. */
export const OFFLINE_QUEUE_MAX = 500;
/** Events per `offline.events` message. */
export const OFFLINE_BATCH_MAX = 50;
/** Largest frame the server accepts (WebSocket `maxPayload`). */
export const FRAME_MAX_BYTES = 64 * 1024;
/** Longest short name the roster of a snapshot carries. */
export const ROSTER_NAME_MAX = 16;

export const OFFLINE_ALARM_ENDS = ['button', 'all_exited', 'timeout'] as const;

/**
 * Why an offline event was not applied and waits for a person. The set is
 * closed: the panel translates every code.
 */
export const OFFLINE_REVIEW_REASONS = [
  'EXIT_WITHOUT_ENTRY',
  'DUPLICATE_ENTRY',
  'OUTSIDE_WINDOW',
  'NOT_IN_SCHEDULE',
  'ALREADY_EXITED',
  'STUDENT_INACTIVE',
  'SESSION_ALREADY_CLOSED',
  'OUT_OF_ORDER',
  'TS_FUTURE',
  'TS_TOO_OLD',
  'UNKNOWN_SNAPSHOT',
  'UNKNOWN_SLOT',
] as const;

export const offlineReviewReasonSchema = z.enum(OFFLINE_REVIEW_REASONS);
export type OfflineReviewReason = z.infer<typeof offlineReviewReasonSchema>;

const count = z.number().int().nonnegative();

// Printable ASCII only: the LCD of the reader has no accents.
const rosterNameSchema = z
  .string()
  .min(1)
  .max(ROSTER_NAME_MAX)
  .regex(/^[\x20-\x7e]+$/, 'must be printable ASCII');

const eventBase = {
  /** UUID v4 made on the device and reused in every retry (idempotency key). */
  id: uuidSchema,
  /** Increasing counter that breaks ties between events with the same `ts`. */
  seq: count,
  /** When it happened, by the device clock (Unix seconds). */
  ts: unixSecondsSchema,
  /** Snapshot the device decided with; the server resolves `slot` with it. */
  snapshotId: uuidSchema,
};

export const offlineEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...eventBase,
    type: z.literal('entry'),
    slot: slotSchema,
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('exit'),
    slot: slotSchema,
  }),
  // Informational: the server only counts it.
  z.strictObject({ ...eventBase, type: z.literal('unknown') }),
  // One event when a local alarm ends; `ts` is its start.
  z.strictObject({
    ...eventBase,
    type: z.literal('alarm'),
    endTs: unixSecondsSchema.nullable(),
    endedBy: z.enum(OFFLINE_ALARM_ENDS),
  }),
]);
export type OfflineEvent = z.infer<typeof offlineEventSchema>;

/** `hello` additions, all optional: without them the device is a v0 one. */
export const helloExtensionShape = {
  capabilities: z.array(deviceCapabilitySchema).max(8).optional(),
  deviceTime: unixSecondsSchema.optional(),
  queued: count.optional(),
};

export const offlineEventsPayloadSchema = z.strictObject({
  batch: z.number().int().min(1),
  last: z.boolean(),
  // Each event is validated on its own (`offlineEventSchema`): one bad event
  // must not discard the others of the batch.
  events: z.array(z.unknown()).min(1).max(OFFLINE_BATCH_MAX),
});

const snapshotScheduleSchema = z.strictObject({
  scheduleId: nonEmptyStringSchema,
  start: unixSecondsSchema,
  end: unixSecondsSchema,
  entryOpensAt: unixSecondsSchema,
  entryClosesAt: unixSecondsSchema,
});

export const offlineSnapshotPayloadSchema = z.strictObject({
  snapshotId: uuidSchema,
  generatedAt: unixSecondsSchema,
  /** Null = no upcoming schedule: the device refuses scans while offline. */
  schedule: snapshotScheduleSchema.nullable(),
  roster: z
    .array(z.strictObject({ slot: slotSchema, name: rosterNameSchema }))
    .max(162),
  /** Slots inside right now / that already left in this occurrence. */
  open: z.array(slotSchema).max(162),
  exited: z.array(slotSchema).max(162),
  limits: z.strictObject({
    queueMax: z.number().int().positive(),
    batchMax: z.number().int().positive(),
  }),
});
