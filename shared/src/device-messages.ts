import { z } from 'zod';
import {
  base64Schema,
  emptyPayloadSchema,
  message,
  nonEmptyStringSchema,
  slotSchema,
  uuidSchema,
} from './envelope.js';
import { ackSchema } from './ack.js';

export const ENROLL_STEPS = [
  'place_finger',
  'remove_finger',
  'place_again',
  'processing',
] as const;

export const ALARM_SOURCES = ['server', 'button', 'local'] as const;

const count = z.number().int().nonnegative();

export const helloSchema = message(
  'hello',
  z.strictObject({
    deviceId: nonEmptyStringSchema,
    token: nonEmptyStringSchema,
    fw: nonEmptyStringSchema,
  }),
);

export const fingerprintScanSchema = message(
  'fingerprint.scan',
  z.strictObject({
    slot: slotSchema,
    // AS608 reports a match score, not a percentage.
    confidence: count,
  }),
);

export const fingerprintUnknownSchema = message(
  'fingerprint.unknown',
  emptyPayloadSchema,
);

export const enrollProgressSchema = message(
  'enroll.progress',
  z.strictObject({
    enrollmentId: uuidSchema,
    step: z.enum(ENROLL_STEPS),
  }),
);

export const enrollDoneSchema = message(
  'enroll.done',
  z.strictObject({
    enrollmentId: uuidSchema,
    template: base64Schema,
  }),
);

export const enrollFailedSchema = message(
  'enroll.failed',
  z.strictObject({
    enrollmentId: uuidSchema,
    // Free text: the AS608 failure catalogue is not closed in protocol v0.
    reason: nonEmptyStringSchema,
  }),
);

export const alarmStateSchema = message(
  'alarm.state',
  z.strictObject({
    on: z.boolean(),
    source: z.enum(ALARM_SOURCES),
  }),
);

export const buttonPressedSchema = message(
  'button.pressed',
  emptyPayloadSchema,
);

export const statusSchema = message(
  'status',
  z.strictObject({
    uptime: count,
    heap: count,
    rssi: z.number().int(),
    fingerprintCount: count,
  }),
);

/** Messages sent by the device. `ack` is shared by both directions. */
export const deviceMessageSchema = z.discriminatedUnion('type', [
  helloSchema,
  fingerprintScanSchema,
  fingerprintUnknownSchema,
  enrollProgressSchema,
  enrollDoneSchema,
  enrollFailedSchema,
  alarmStateSchema,
  buttonPressedSchema,
  statusSchema,
  ackSchema,
]);

export type DeviceMessage = z.infer<typeof deviceMessageSchema>;
export type DeviceMessageType = DeviceMessage['type'];
