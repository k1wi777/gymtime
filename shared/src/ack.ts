import { z } from 'zod';
import { ackErrorSchema } from './errors.js';
import { message } from './envelope.js';

const ackPayloadSchema = z.strictObject({
  ok: z.boolean(),
  error: ackErrorSchema.optional(),
});

export const ackSchema = message('ack', ackPayloadSchema, {
  isResponse: true,
});

export type AckMessage = z.infer<typeof ackSchema>;
