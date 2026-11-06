import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { Account } from '../../auth/account.js';
import type { PanelRole } from '../../auth/domain/panel-user.js';

export const API_KEY_HEADER = 'x-api-key';
/** Custom header the panel must send on mutations (CSRF defence). */
export const CLIENT_HEADER = 'x-gymtime-client';
export const CLIENT_HEADER_VALUE = 'panel';

/** Who is calling, as decided by the global guard. */
export type AuthContext =
  | { kind: 'system'; role: 'admin' }
  | {
      kind: 'session';
      role: PanelRole;
      sessionId: string;
      account: Account;
    };

export type AuthedRequest = Request & { auth?: AuthContext };

/** The authenticated caller; only available behind the guard. */
export const Auth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext | undefined =>
    context.switchToHttp().getRequest<AuthedRequest>().auth,
);
