import { AsyncLocalStorage } from 'node:async_hooks';

export const ACTOR_TYPES = ['user', 'system', 'device'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Who originated an audited event. */
export interface Actor {
  type: ActorType;
  id: string | null;
}

/** The admin API key (CLI, scripts) acts as the system. */
export const SYSTEM_ACTOR: Actor = { type: 'system', id: null };

export const deviceActor = (deviceId: string): Actor => ({
  type: 'device',
  id: deviceId,
});

/** Mutable so the auth guard, which runs after the middleware, can set the user. */
interface ActorBox {
  actor: Actor;
}

const storage = new AsyncLocalStorage<ActorBox>();

/** Runs `action` (and everything it awaits) on behalf of `actor`. */
export function runAsActor<T>(actor: Actor, action: () => T): T {
  return storage.run({ actor }, action);
}

/** The actor of the current request or message; `system` outside any context. */
export function currentActor(): Actor {
  return storage.getStore()?.actor ?? SYSTEM_ACTOR;
}

/** Replaces the actor of the running context; a no-op outside any context. */
export function setCurrentActor(actor: Actor): void {
  const box = storage.getStore();
  if (box) box.actor = actor;
}
