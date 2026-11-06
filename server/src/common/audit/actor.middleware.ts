import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SYSTEM_ACTOR, runAsActor } from './actor.js';

/**
 * Opens the actor context of every HTTP request. Until the accounts of the
 * panel exist, the only credential is the admin key, so the actor is `system`;
 * this is the single place to replace with the logged-in user.
 */
@Injectable()
export class ActorMiddleware implements NestMiddleware {
  use(_request: Request, _response: Response, next: NextFunction): void {
    runAsActor(SYSTEM_ACTOR, next);
  }
}
