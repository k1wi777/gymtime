import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './../src/config/env.schema.js';

// ConfigModule.forRoot runs during application bootstrap, before Nest opens a port.
describe('Startup (e2e)', () => {
  it('refuses to start naming the missing variable', async () => {
    const forRoot = ConfigModule.forRoot({
      ignoreEnvFile: true,
      ignoreEnvVars: true,
      validate: () =>
        validateEnv({
          DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
          DEVICE_TOKEN: 'device-token-123456',
        }),
    });
    await expect(forRoot).rejects.toThrow(/ADMIN_API_KEY: is missing/);
  });
});
