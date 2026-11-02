import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import type { PrismaService } from '../database/prisma.service.js';

const controllerWith = (query: () => Promise<unknown>) =>
  new HealthController({ $queryRaw: query } as unknown as PrismaService);

describe('HealthController', () => {
  it('reports ok with uptime when the database answers', async () => {
    const result = await controllerWith(async () => [
      { '?column?': 1 },
    ]).check();
    expect(result).toMatchObject({ status: 'ok', database: 'up' });
    expect(typeof result.uptime).toBe('number');
  });

  it('responds 503 when the database fails', async () => {
    const controller = controllerWith(async () => {
      throw new Error('connection refused');
    });
    const error = await controller.check().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      status: 'error',
      database: 'down',
    });
  });
});
