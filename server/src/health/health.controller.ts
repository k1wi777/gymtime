import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service.js';

const DB_TIMEOUT_MS = 2000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness and database check (public)' })
  @ApiOkResponse({ description: 'Service up and database reachable' })
  @ApiServiceUnavailableResponse({ description: 'Database not responding' })
  async check() {
    const base = { uptime: Math.round(process.uptime()) };
    try {
      await this.pingDatabase();
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        ...base,
        database: 'down',
      });
    }
    return { status: 'ok', ...base, database: 'up' };
  }

  private async pingDatabase(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('database ping timed out')),
        DB_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
