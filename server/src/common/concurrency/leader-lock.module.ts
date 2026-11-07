import { Global, Module } from '@nestjs/common';
import { LEADER_LOCK } from './leader-lock.js';
import { PgLeaderLock } from './pg-leader-lock.js';

/** Provides the lock to every scheduler; swap `LEADER_LOCK` in tests. */
@Global()
@Module({
  providers: [{ provide: LEADER_LOCK, useClass: PgLeaderLock }],
  exports: [LEADER_LOCK],
})
export class LeaderLockModule {}
