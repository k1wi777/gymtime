import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DISPLAY_TONES, type DisplayTone } from '@gymtime/shared';
import { z } from 'zod';

// Exact length limits depend on DISPLAY_TITLE_MAX/DISPLAY_SUBTITLE_MAX/
// DISPLAY_SUBTITLE_LINES and are checked by the service; here only the shape
// and an absolute cap.
const text = z.string().max(300);

// `line1`/`line2` are deprecated aliases of `title`/`subtitle` (transition of
// protocol v1); `title` wins when both are sent.
export const sendMessageSchema = z
  .strictObject({
    deviceId: z.string().trim().min(1).max(100).optional(),
    title: text.optional(),
    subtitle: text.optional(),
    tone: z.enum(DISPLAY_TONES).default('info'),
    line1: text.optional(),
    line2: text.optional(),
    durationSec: z.number().int().min(1).max(60).optional(),
  })
  .transform(({ line1, line2, title, subtitle, ...rest }) => ({
    ...rest,
    title: title ?? line1 ?? '',
    subtitle: subtitle ?? line2,
  }))
  .refine((body) => body.title.trim() !== '', {
    message: 'title is required',
    path: ['title'],
  });

export type SendMessageBody = z.infer<typeof sendMessageSchema>;

export class SendMessageDto {
  @ApiPropertyOptional({
    description: 'Target device; defaults to the only online or known one',
  })
  deviceId?: string;
  @ApiPropertyOptional({
    description:
      'Title: one line, up to DISPLAY_TITLE_MAX characters (32 by default). Accents are kept. Required unless the deprecated alias line1 is sent',
  })
  title: string;
  @ApiPropertyOptional({
    description:
      'Subtitle: up to DISPLAY_SUBTITLE_MAX characters (80) and DISPLAY_SUBTITLE_LINES lines (2) separated by a line break',
  })
  subtitle?: string;
  @ApiPropertyOptional({
    enum: DISPLAY_TONES,
    default: 'info',
    description: 'Colour intent; the firmware picks the RGB',
  })
  tone?: DisplayTone;
  @ApiPropertyOptional({
    deprecated: true,
    description: 'Deprecated alias of title',
  })
  line1?: string;
  @ApiPropertyOptional({
    deprecated: true,
    description: 'Deprecated alias of subtitle',
  })
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
