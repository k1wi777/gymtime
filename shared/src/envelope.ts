import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

/** Highest fingerprint slot of the AS608 reader used by the project. */
export const SLOT_MAX = 162;

/** Maximum number of templates the server sends in one `templates.sync` chunk. */
export const SYNC_CHUNK_MAX = 10;

export const uuidSchema = z.uuid();

/** Unix time in whole seconds (UTC). */
export const unixSecondsSchema = z.number().int().nonnegative();

export const nonEmptyStringSchema = z.string().min(1);

export const slotSchema = z.number().int().min(1).max(SLOT_MAX);

// Strict base64 with padding; the AS608 template length is "~512 B", so no fixed length.
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const base64Schema = z
  .string()
  .min(1)
  .regex(BASE64_PATTERN, 'must be valid base64');

/**
 * Builds the strict envelope `{v, id, type, ts, ref, payload}` for one message.
 * Responses (`ack`, `hello.ok`, `scan.result`) require `ref`; all others use null.
 */
export function message<
  const T extends string,
  const P extends z.ZodType,
  const R extends boolean = false,
>(type: T, payload: P, options?: { isResponse?: R }) {
  return z.strictObject({
    v: z.literal(PROTOCOL_VERSION),
    id: uuidSchema,
    type: z.literal(type),
    ts: unixSecondsSchema,
    ref: options?.isResponse ? uuidSchema : z.null(),
    payload,
  });
}

export const emptyPayloadSchema = z.strictObject({});
