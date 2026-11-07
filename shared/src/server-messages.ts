import { z } from 'zod';
import {
  SYNC_CHUNK_MAX,
  base64Schema,
  message,
  nonEmptyStringSchema,
  slotSchema,
  unixSecondsSchema,
  uuidSchema,
} from './envelope.js';
import { rejectReasonSchema } from './errors.js';
import { ackSchema } from './ack.js';
import { offlineSnapshotPayloadSchema } from './offline.js';

export const SCAN_RESULTS = ['entry', 'exit', 'denied', 'unknown'] as const;

export const ALARM_REASONS = [
  'END_BEEP',
  'PENDING_EXIT',
  'MANUAL',
  'TEST',
  'CLEARED',
] as const;

const positiveInt = z.number().int().positive();

export const helloOkSchema = message(
  'hello.ok',
  z.strictObject({
    serverTime: unixSecondsSchema,
    heartbeatSec: positiveInt,
  }),
  { isResponse: true },
);

const displaySchema = z.strictObject({
  line1: z.string(),
  line2: z.string(),
  // Free text: protocol v0 does not enumerate colors.
  color: nonEmptyStringSchema,
});

// `reason` is coupled to `result` so that firmware never sees ambiguous cases.
const scanResultPayloadSchema = z.discriminatedUnion('result', [
  z.strictObject({
    result: z.literal('entry'),
    studentName: nonEmptyStringSchema,
    reason: z.null(),
    display: displaySchema,
  }),
  z.strictObject({
    result: z.literal('exit'),
    studentName: nonEmptyStringSchema,
    reason: z.null(),
    display: displaySchema,
  }),
  z.strictObject({
    result: z.literal('denied'),
    studentName: nonEmptyStringSchema.nullable(),
    reason: rejectReasonSchema,
    display: displaySchema,
  }),
  z.strictObject({
    result: z.literal('unknown'),
    studentName: z.null(),
    reason: z.null(),
    display: displaySchema,
  }),
]);

export const scanResultSchema = message(
  'scan.result',
  scanResultPayloadSchema,
  {
    isResponse: true,
  },
);

export const enrollStartSchema = message(
  'enroll.start',
  z.strictObject({
    enrollmentId: uuidSchema,
    scratchSlot: slotSchema,
    timeoutSec: positiveInt,
  }),
);

export const enrollCancelSchema = message(
  'enroll.cancel',
  z.strictObject({ enrollmentId: uuidSchema }),
);

const syncTemplateSchema = z.strictObject({
  slot: slotSchema,
  template: base64Schema,
});

export const templatesSyncSchema = message(
  'templates.sync',
  z
    .strictObject({
      syncId: uuidSchema,
      chunk: z.strictObject({
        index: positiveInt,
        total: positiveInt,
      }),
      // An empty list is only valid as a single 1-of-1 chunk: it tells the reader
      // to wipe its templates when nobody has to be loaded.
      templates: z.array(syncTemplateSchema).max(SYNC_CHUNK_MAX),
    })
    .superRefine((payload, ctx) => {
      if (payload.chunk.index > payload.chunk.total) {
        ctx.addIssue({
          code: 'custom',
          path: ['chunk', 'index'],
          message: 'chunk.index must be between 1 and chunk.total',
        });
      }
      const { index, total } = payload.chunk;
      if (payload.templates.length === 0 && !(index === 1 && total === 1)) {
        ctx.addIssue({
          code: 'custom',
          path: ['templates'],
          message: 'templates may be empty only when chunk is 1 of 1',
        });
      }
      const slots = new Set<number>();
      payload.templates.forEach((entry, i) => {
        if (slots.has(entry.slot)) {
          ctx.addIssue({
            code: 'custom',
            path: ['templates', i, 'slot'],
            message: 'slot repeated within the chunk',
          });
        }
        slots.add(entry.slot);
      });
    }),
);

export const scheduleSetSchema = message(
  'schedule.set',
  z.strictObject({
    scheduleId: nonEmptyStringSchema,
    start: unixSecondsSchema,
    end: unixSecondsSchema,
    entryOpensAt: unixSecondsSchema,
    entryClosesAt: unixSecondsSchema,
  }),
);

export const alarmSetSchema = message(
  'alarm.set',
  z.strictObject({
    on: z.boolean(),
    // number = sounds that long and stops by itself; null = until another order.
    durationSec: positiveInt.nullable(),
    reason: z.enum(ALARM_REASONS),
  }),
);

export const displayMessageSchema = message(
  'display.message',
  z.strictObject({
    line1: z.string(),
    line2: z.string(),
    durationSec: positiveInt,
  }),
);

export const offlineSnapshotSchema = message(
  'offline.snapshot',
  offlineSnapshotPayloadSchema,
);

/** Messages sent by the server. `ack` is shared by both directions. */
export const serverMessageSchema = z.discriminatedUnion('type', [
  helloOkSchema,
  scanResultSchema,
  enrollStartSchema,
  enrollCancelSchema,
  templatesSyncSchema,
  scheduleSetSchema,
  alarmSetSchema,
  displayMessageSchema,
  offlineSnapshotSchema,
  ackSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ServerMessageType = ServerMessage['type'];
