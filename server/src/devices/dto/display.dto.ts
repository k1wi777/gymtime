import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

// Length and ASCII limits depend on DISPLAY_COLS/ROWS and are checked by the
// service; here only the shape and an absolute cap.
const line = z.string().max(200);

export const sendMessageSchema = z.strictObject({
  deviceId: z.string().trim().min(1).max(100).optional(),
  line1: line.refine((value) => value.trim() !== '', 'line1 is required'),
  line2: line.optional(),
  durationSec: z.number().int().min(1).max(60).optional(),
});

export class SendMessageDto {
  @ApiPropertyOptional({
    description: 'Target device; defaults to the only online or known one',
  })
  deviceId?: string;
  @ApiProperty({ description: 'First LCD line (accents are removed)' })
  line1: string;
  @ApiPropertyOptional({ description: 'Second LCD line' })
  line2?: string;
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 60,
    description: 'Seconds on screen; defaults to DISPLAY_RESULT_SECONDS',
  })
  durationSec?: number;
}

export class SendMessageResultDto {
  @ApiProperty({ format: 'uuid' })
  commandId: string;
  @ApiProperty()
  deviceId: string;
  @ApiProperty({
    enum: ['acked', 'queued', 'failed'],
    description:
      'acked: the reader confirmed; queued: device offline, delivered on reconnect; failed: not confirmed',
  })
  status: 'acked' | 'queued' | 'failed';
}
