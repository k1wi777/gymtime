import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '../common/auth/auth.guard.js';
import { CLOCK, systemClock } from '../common/time/clock.js';
import type { Env } from '../config/env.schema.js';
import { AUTH_CONFIG, authConfigFromEnv } from './auth.config.js';
import { BootstrapAdmin } from './bootstrap-admin.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SESSIONS_REPOSITORY } from './domain/sessions.repository.js';
import { USERS_REPOSITORY } from './domain/users.repository.js';
import { PrismaSessionsRepository } from './infrastructure/prisma-sessions.repository.js';
import { PrismaUsersRepository } from './infrastructure/prisma-users.repository.js';
import { Argon2idPasswordHasher, PasswordHasher } from './password-hasher.js';
import { PanelUsersService } from './panel-users.service.js';
import { SessionCleanup } from './session-cleanup.js';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH_CONFIG,
      inject: [ConfigService],
      useFactory: (env: ConfigService<Env, true>) => authConfigFromEnv(env),
    },
    { provide: CLOCK, useValue: systemClock },
    { provide: USERS_REPOSITORY, useClass: PrismaUsersRepository },
    { provide: SESSIONS_REPOSITORY, useClass: PrismaSessionsRepository },
    { provide: PasswordHasher, useFactory: () => new Argon2idPasswordHasher() },
    AuthService,
    PanelUsersService,
    SessionCleanup,
    BootstrapAdmin,
    // Denies by default: every endpoint needs a credential unless @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, PanelUsersService, PasswordHasher],
})
export class AuthModule {}
