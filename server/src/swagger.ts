import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const ADMIN_KEY_HEADER = 'x-api-key';

/** Publishes Swagger UI at /docs and the OpenAPI JSON at /docs-json. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('GymTime API')
    .setDescription('Attendance and alarm backend for GymTime')
    .setVersion('0.0.1')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: ADMIN_KEY_HEADER },
      'admin-key',
    )
    .addTag('health')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs-json',
  });
}
