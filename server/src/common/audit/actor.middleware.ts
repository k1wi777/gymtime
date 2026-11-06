import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SYSTEM_ACTOR, runAsActor } from './actor.js';

/**
 * Opens the actor context of every HTTP request as `system` (the admin key).
 * The auth guard replaces it with the signed-in user (`setCurrentActor`).
 */
@Injectable()
export class ActorMiddleware implements NestMiddleware {
  use(_request: Request, _response: Response, next: NextFunction): void {
    runAsActor(SYSTEM_ACTOR, next);
  }
}
