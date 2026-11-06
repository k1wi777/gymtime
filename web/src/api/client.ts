import createClient from 'openapi-fetch';
import type { paths } from './schema';
import { apiUrl } from '@/lib/env';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Anti-CSRF header the API requires on every request that changes data. */
export const CLIENT_HEADER = 'x-gymtime-client';
export const CLIENT_HEADER_VALUE = 'panel';

export interface ApiIssue {
  path: string;
  message: string;
}

/** Any failure of an API call, normalized. `status` 0 means no answer (network). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly issues: ApiIssue[] = [],
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Central reactions to the answers that every screen treats the same way. */
export interface ApiHandlers {
  /** 401 on anything but the login: the session is gone. */
  onUnauthorized?: () => void;
  /** 403 PASSWORD_CHANGE_REQUIRED: only the password change is allowed. */
  onPasswordChangeRequired?: () => void;
  /** Any other 403: the role does not allow it. */
  onForbidden?: (error: ApiError) => void;
}

export interface ApiOptions {
  baseUrl: string;
  /** Replaced in tests. Receives the ready `Request`. */
  fetch?: (request: Request) => Promise<Response>;
}

export function createApi(options: ApiOptions) {
  const handlers: ApiHandlers = {};
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: 'include',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  client.use({
    onRequest({ request }) {
      if (MUTATING.has(request.method.toUpperCase())) {
        request.headers.set(CLIENT_HEADER, CLIENT_HEADER_VALUE);
      }
      return request;
    },
    async onResponse({ request, response }) {
      if (response.status === 401) {
        // A wrong password on the login is an answer, not an expired session.
        if (!new URL(request.url).pathname.endsWith('/auth/login')) {
          handlers.onUnauthorized?.();
        }
      } else if (response.status === 403) {
        const error = await readError(response.clone(), undefined);
        if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
          handlers.onPasswordChangeRequired?.();
        } else {
          handlers.onForbidden?.(error);
        }
      }
      return response;
    },
  });

  return { client, handlers };
}

export type Api = ReturnType<typeof createApi>;

let instance: Api | undefined;

/** The panel's API client, created on first use from `NEXT_PUBLIC_API_URL`. */
export function getApi(): Api {
  instance ??= createApi({ baseUrl: apiUrl() });
  return instance;
}

/** Tests install a client with a fake `fetch`. */
export function setApi(api: Api | undefined): void {
  instance = api;
}

interface Result<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * Awaits an `openapi-fetch` call and returns its data, or throws an
 * `ApiError`. A request that never got an answer becomes status 0.
 */
export async function call<T>(request: Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await request;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, 'NETWORK', 'No hubo respuesta del servidor');
  }
  if (result.response.ok) return result.data as T;
  throw await readError(result.response, result.error);
}

async function readError(
  response: Response,
  parsed: unknown,
): Promise<ApiError> {
  let body: unknown = parsed;
  if (body === undefined) {
    body = await response.json().catch(() => null);
  }
  const record = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  const message = Array.isArray(record.message)
    ? record.message.join(', ')
    : typeof record.message === 'string'
      ? record.message
      : response.statusText;
  const issues = Array.isArray(record.issues)
    ? (record.issues as ApiIssue[])
    : [];
  const retry = Number(response.headers.get('retry-after'));
  return new ApiError(
    response.status,
    typeof record.code === 'string' ? record.code : null,
    message,
    issues,
    Number.isFinite(retry) && retry > 0 ? retry : null,
  );
}
