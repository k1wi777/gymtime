import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_CONFIG, type AuthConfig } from '../../auth/auth.config.js';
import { AuthService } from '../../auth/auth.service.js';
import { SESSION_COOKIE, readCookie } from '../../auth/cookie.js';
import { checkCsrf } from '../../auth/csrf.js';
import type { PanelRole } from '../../auth/domain/panel-user.js';
import { setCurrentActor } from '../audit/actor.js';
import { API_KEY_HEADER, type AuthedRequest } from './auth-context.js';
import {
  ACCOUNT_REQUIRED_KEY,
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from './roles.decorator.js';
import { safeEqual } from './safe-equal.js';

/** While the password is temporary only these routes answer. */
const PASSWORD_CHANGE_ROUTES = new Set([
  '/auth/me',
  '/auth/logout',
  '/auth/password',
]);

const forbidden = (code: string, message: string): ForbiddenException =>
  new ForbiddenException({ statusCode: 403, code, message });

/**
 * Global guard (APP_GUARD): denies by default. Every HTTP endpoint needs
 * either the system credential (`x-api-key`, acts as admin) or a session
 * cookie, unless it is `@Public()`; `@Roles()` narrows who may call it. The
 * WebSocket `/device` is a raw upgrade outside Nest and keeps its own token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      // Public mutations (the login) still defend against login CSRF.
      this.assertCsrf(request);
      return true;
    }
    const roles = this.reflector.getAllAndOverride<PanelRole[] | undefined>(
      ROLES_KEY,
      targets,
    );

    const apiKey = request.headers[API_KEY_HEADER];
    if (apiKey !== undefined) {
      // A wrong key never falls back to the cookie.
      if (
        typeof apiKey !== 'string' ||
        !safeEqual(apiKey, this.config.adminApiKey)
      ) {
        throw new UnauthorizedException('Missing or invalid API key');
      }
      if (
        this.reflector.getAllAndOverride<boolean>(ACCOUNT_REQUIRED_KEY, targets)
      ) {
        throw forbidden(
          'ACCOUNT_REQUIRED',
          'This endpoint needs a signed-in account',
        );
      }
      request.auth = { kind: 'system', role: 'admin' };
      return true;
    }

    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) throw new UnauthorizedException('Authentication required');
    // Before touching the session: a forged request must not renew it.
    this.assertCsrf(request);
    const session = await this.auth.authenticate(token);
    if (!session) throw new UnauthorizedException('Authentication required');

    const { account } = session;
    setCurrentActor({ type: 'user', id: account.id });
    if (
      account.mustChangePassword &&
      !PASSWORD_CHANGE_ROUTES.has(normalizePath(request.path))
    ) {
      throw forbidden(
        'PASSWORD_CHANGE_REQUIRED',
        'Debe cambiar la contraseña temporal antes de continuar',
      );
    }
    if (roles && !roles.includes(account.role)) {
      throw forbidden('FORBIDDEN_ROLE', 'Su rol no permite esta operación');
    }
    request.auth = {
      kind: 'session',
      role: account.role,
      sessionId: session.sessionId,
      account,
    };
    return true;
  }

  private assertCsrf(request: AuthedRequest): void {
    if (checkCsrf(request, this.config.corsOrigins) !== null) {
      throw forbidden(
        'CSRF_REJECTED',
        'Petición rechazada: falta la cabecera del cliente o el origen no está permitido',
      );
    }
  }
}

const normalizePath = (path: string): string =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
