import { z } from 'zod';
import type { AckError } from './errors.js';
import { PROTOCOL_VERSION } from './envelope.js';
import { deviceMessageSchema, type DeviceMessage } from './device-messages.js';
import { serverMessageSchema, type ServerMessage } from './server-messages.js';

export type ParseResult<T> =
  | { ok: true; message: T }
  | {
      ok: false;
      /** Ready to be sent as `ack.payload.error`. */
      code: Extract<
        AckError,
        'INVALID_MESSAGE' | 'UNSUPPORTED_VERSION' | 'UNKNOWN_TYPE'
      >;
      /** Human-readable explanation naming the affected field. */
      reason: string;
    };

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function parseMessage<T>(
  schema: z.ZodType<T>,
  knownTypes: ReadonlySet<string>,
  input: unknown,
): ParseResult<T> {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, code: 'INVALID_MESSAGE', reason: 'malformed JSON' };
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      code: 'INVALID_MESSAGE',
      reason: 'message must be a JSON object',
    };
  }
  const { v, type } = value as Record<string, unknown>;
  if (v !== undefined && v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_VERSION',
      reason: `v: unsupported version, expected ${PROTOCOL_VERSION}`,
    };
  }
  if (typeof type === 'string' && !knownTypes.has(type)) {
    return {
      ok: false,
      code: 'UNKNOWN_TYPE',
      reason: `type: unknown message type "${type}"`,
    };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, message: result.data };
  return {
    ok: false,
    code: 'INVALID_MESSAGE',
    reason: formatIssues(result.error),
  };
}

const deviceTypes: ReadonlySet<string> = new Set(
  deviceMessageSchema.options.map((option) => option.shape.type.value),
);
const serverTypes: ReadonlySet<string> = new Set(
  serverMessageSchema.options.map((option) => option.shape.type.value),
);

/** Validates a message received by the server. Never throws. */
export function parseDeviceMessage(input: unknown): ParseResult<DeviceMessage> {
  return parseMessage(deviceMessageSchema, deviceTypes, input);
}

/** Validates a message received by the device. Never throws. */
export function parseServerMessage(input: unknown): ParseResult<ServerMessage> {
  return parseMessage(serverMessageSchema, serverTypes, input);
}
