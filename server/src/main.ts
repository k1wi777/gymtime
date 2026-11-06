import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.schema.js';
import { configureHttp, httpOptionsFromEnv } from './http-setup.js';
import { setupSwagger } from './swagger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();
  setupSwagger(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  configureHttp(app, httpOptionsFromEnv(config));
  const host = config.get('HOST', { infer: true });
  const port = config.get('PORT', { infer: true });
  await app.listen(port, host);
  logger.log(
    `Server listening on http://${host}:${port} (docs at /docs, node ${process.version})`,
  );
}
await bootstrap();
