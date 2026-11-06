import { ApiError, call } from '@/api/client';
import { describeError } from '@/api/errors';
import { json, installFakeApi } from './helpers';

describe('API client (R8)', () => {
  it('sends the cookie on every request and the CSRF header only on mutations', async () => {
    const fake = installFakeApi({
      'GET /alarm/status': {},
      'POST /alarm/off': {},
      'PATCH /students/abc': {},
    });
    const { client } = fake.api;

    await client.GET('/alarm/status');
    await client.POST('/alarm/off');
    await client.PATCH('/students/{id}', {
      params: { path: { id: 'abc' } },
      body: { consented: true },
    });

    const [get, post, patch] = fake.requests;
    expect(get?.credentials).toBe('include');
    expect(get?.headers.get('x-gymtime-client')).toBeNull();
    expect(post?.headers.get('x-gymtime-client')).toBe('panel');
    expect(patch?.headers.get('x-gymtime-client')).toBe('panel');
    expect(patch?.credentials).toBe('include');
  });

  it('also protects the login, which the server requires too', async () => {
    const fake = installFakeApi({ 'POST /auth/login': {} });
    await fake.api.client.POST('/auth/login', {
      body: { username: 'ana', password: 'secret-password' },
    });
    expect(fake.requests[0]?.headers.get('x-gymtime-client')).toBe('panel');
  });

  it('calls onUnauthorized on 401, but not for a failed login', async () => {
    const fake = installFakeApi({
      'GET /auth/me': () => json({ statusCode: 401, message: 'x' }, 401),
      'POST /auth/login': () =>
        json(
          { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'x' },
          401,
        ),
    });
    const onUnauthorized = vi.fn();
    fake.api.handlers.onUnauthorized = onUnauthorized;

    await fake.api.client.POST('/auth/login', {
      body: { username: 'a', password: 'b' },
    });
    expect(onUnauthorized).not.toHaveBeenCalled();

    await fake.api.client.GET('/auth/me');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('routes 403 PASSWORD_CHANGE_REQUIRED and the other 403s apart', async () => {
    const fake = installFakeApi({
      'GET /students': () =>
        json(
          { statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED', message: 'x' },
          403,
        ),
      'GET /schedules': () =>
        json({ statusCode: 403, code: 'FORBIDDEN_ROLE', message: 'x' }, 403),
    });
    const onPasswordChangeRequired = vi.fn();
    const onForbidden = vi.fn();
    fake.api.handlers.onPasswordChangeRequired = onPasswordChangeRequired;
    fake.api.handlers.onForbidden = onForbidden;

    await fake.api.client.GET('/students', {});
    expect(onPasswordChangeRequired).toHaveBeenCalledTimes(1);
    expect(onForbidden).not.toHaveBeenCalled();

    await fake.api.client.GET('/schedules');
    expect(onForbidden).toHaveBeenCalledTimes(1);
    expect(onForbidden.mock.calls[0]?.[0]).toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
  });

  it('call() returns the data and throws a normalized ApiError otherwise', async () => {
    const fake = installFakeApi({
      'GET /alarm/status': { on: true },
      'POST /attendance/entry': () =>
        json(
          { statusCode: 409, code: 'SESSION_ALREADY_OPEN', message: 'x' },
          409,
        ),
      'GET /devices/status': () =>
        json({ statusCode: 429, message: 'x' }, 429, { 'retry-after': '12' }),
    });
    const { client } = fake.api;

    await expect(call(client.GET('/alarm/status'))).resolves.toEqual({
      on: true,
    });

    const conflict = await call(
      client.POST('/attendance/entry', {
        body: { studentId: 's', reason: 'r' },
      }),
    ).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(ApiError);
    expect(conflict).toMatchObject({
      status: 409,
      code: 'SESSION_ALREADY_OPEN',
    });
    expect(describeError(conflict)).toBe(
      'El estudiante ya tiene una entrada abierta.',
    );

    const limited = await call(client.GET('/devices/status')).catch(
      (e: unknown) => e,
    );
    expect(limited).toMatchObject({ status: 429, retryAfterSeconds: 12 });
    expect(describeError(limited)).toContain('12 s');
  });

  it('turns a request with no answer into status 0 with a Spanish message', async () => {
    const fake = installFakeApi({
      'GET /alarm/status': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const failure = await call(fake.api.client.GET('/alarm/status')).catch(
      (e: unknown) => e,
    );
    expect(failure).toMatchObject({ status: 0, code: 'NETWORK' });
    expect(describeError(failure)).toContain('No hay conexión');
  });
});

describe('describeError', () => {
  it('never exposes the server text when the code is known', () => {
    const error = new ApiError(
      409,
      'DEVICE_BUSY',
      'The device already has an open enrollment',
    );
    expect(describeError(error)).toBe(
      'El lector ya tiene un enrolamiento en curso.',
    );
  });

  it('keeps the Spanish password policy message sent by the server', () => {
    const error = new ApiError(
      400,
      'PASSWORD_POLICY',
      'La contraseña debe tener al menos 10 caracteres',
    );
    expect(describeError(error)).toBe(
      'La contraseña debe tener al menos 10 caracteres',
    );
  });

  it('falls back to the status for unknown codes and hides 5xx details', () => {
    expect(describeError(new ApiError(404, null, 'Not Found'))).toContain(
      'No se encontró',
    );
    expect(describeError(new ApiError(500, null, 'stack trace'))).not.toContain(
      'stack',
    );
    expect(describeError(new Error('boom'))).toBe(
      'Ocurrió un error inesperado.',
    );
  });
});
