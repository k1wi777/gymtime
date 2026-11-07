import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.schema.js';
import { configureHttp, httpOptionsFromEnv } from './http-setup.js';
import { productionWarnings } from './production-warnings.js';
import { docsEnabled, setupSwagger } from './swagger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const env = {
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    ENABLE_DOCS: config.get('ENABLE_DOCS', { infer: true }),
    TRUST_PROXY: config.get('TRUST_PROXY', { infer: true }),
    COOKIE_DOMAIN: config.get('COOKIE_DOMAIN', { infer: true }),
    CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
    DEVICE_TOKEN: config.get('DEVICE_TOKEN', { infer: true }),
  };
  const docs = docsEnabled(env);
  if (docs) setupSwagger(app);
  for (const message of productionWarnings(env)) logger.warn(message);
  configureHttp(app, httpOptionsFromEnv(config));
  const host = config.get('HOST', { infer: true });
  const port = config.get('PORT', { infer: true });
  await app.listen(port, host);
  logger.log(
    `Server listening on http://${host}:${port} (${docs ? 'docs at /docs, ' : ''}node ${process.version})`,
  );
}
await bootstrap();
