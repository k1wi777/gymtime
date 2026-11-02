import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { fileURLToPath } from 'node:url';
import { validateEnv } from './env.schema.js';

// The single .env lives at the repo root; resolve it independently of the cwd.
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ROOT_ENV_FILE,
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
