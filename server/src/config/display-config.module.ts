import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DISPLAY_CONFIG, type DisplayConfig } from './display.config.js';
import type { Env } from './env.schema.js';

/** Reader screen settings, shared by devices, students, attendance and alarm. */
@Global()
@Module({
  providers: [
    {
      provide: DISPLAY_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DisplayConfig => ({
        cols: config.get('DISPLAY_COLS', { infer: true }),
        rows: config.get('DISPLAY_ROWS', { infer: true }),
        resultSeconds: config.get('DISPLAY_RESULT_SECONDS', { infer: true }),
      }),
    },
  ],
  exports: [DISPLAY_CONFIG],
})
export class DisplayConfigModule {}
