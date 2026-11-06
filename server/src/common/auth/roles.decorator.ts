import { SetMetadata, applyDecorators } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { PanelRole } from '../../auth/domain/panel-user.js';

export const IS_PUBLIC_KEY = 'auth:public';
export const ROLES_KEY = 'auth:roles';
export const ACCOUNT_REQUIRED_KEY = 'auth:account';

/** No credential required. Only `/health` and `POST /auth/login` use it. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restricts an endpoint (or a controller) to these roles. Without it an
 * endpoint accepts a session of any role: the guard denies by default.
 */
export const Roles = (
  ...roles: PanelRole[]
): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

/**
 * The endpoint acts on the caller's own account, so the system key (which has
 * none) is refused by the guard, before any validation runs.
 */
export const AccountRequired = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCOUNT_REQUIRED_KEY, true);

/** Swagger: either the admin key or the session cookie authenticates. */
export const ApiAuth = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiSecurity('admin-key'),
    ApiSecurity('session'),
    ApiUnauthorizedResponse({ description: 'No valid credential' }),
    ApiForbiddenResponse({
      description:
        'Role not allowed (FORBIDDEN_ROLE), anti-CSRF check failed (CSRF_REJECTED) or password change pending (PASSWORD_CHANGE_REQUIRED)',
    }),
  );
