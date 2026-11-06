import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ enum: ['ok', 'error'] })
  status: 'ok' | 'error';
  @ApiProperty({ description: 'Seconds since the process started' })
  uptime: number;
  @ApiProperty({ enum: ['up', 'down'] })
  database: 'up' | 'down';
}
