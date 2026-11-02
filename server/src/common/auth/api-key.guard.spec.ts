import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { ApiKeyGuard } from './api-key.guard.js';

const KEY = 'admin-key-1234567890';
const guard = new ApiKeyGuard({
  get: () => KEY,
} as unknown as ConfigService<Env, true>);

const context = (headers: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

describe('ApiKeyGuard', () => {
  it('allows the configured key', () => {
    expect(guard.canActivate(context({ 'x-api-key': KEY }))).toBe(true);
  });

  it.each([{}, { 'x-api-key': 'wrong' }, { 'x-api-key': ['a', 'b'] }])(
    'rejects %j',
    (headers) => {
      expect(() => guard.canActivate(context(headers))).toThrow(
        UnauthorizedException,
      );
    },
  );
});
