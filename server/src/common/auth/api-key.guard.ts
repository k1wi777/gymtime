import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../config/env.schema.js';
import { safeEqual } from './safe-equal.js';

export const API_KEY_HEADER = 'x-api-key';

/** Minimal administration guard: header `x-api-key` must equal ADMIN_API_KEY. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[API_KEY_HEADER];
    const expected = this.config.get('ADMIN_API_KEY', { infer: true });
    if (typeof provided !== 'string' || !safeEqual(provided, expected)) {
      throw new UnauthorizedException('Missing or invalid API key');
    }
    return true;
  }
}
