import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OFFLINE_REVIEW_REASONS,
  type OfflineReviewReason,
} from '@gymtime/shared';
import { z } from 'zod';
import type {
  OfflineEventType,
  OfflineOutcome,
  OfflineResolution,
} from '../domain/offline-event.js';
import type { ReviewItem } from '../offline-review.service.js';

const EVENT_TYPES = ['entry', 'exit', 'unknown', 'alarm'] as const;
const OUTCOMES = [
  'pendiente',
  'applied',
  'por_revisar',
  'aprobado',
  'corregido',
  'descartado',
  'informativo',
  'invalido',
] as const;
const RESOLUTIONS = ['aprobar', 'corregir', 'descartar'] as const;
/** Groups the panel filters by. */
export const REVIEW_VIEWS = [
  'pending',
  'resolved',
  'discarded',
  'all',
] as const;

export const reviewQuerySchema = z.strictObject({
  view: z.enum(REVIEW_VIEWS).default('pending'),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const resolveSchema = z
  .strictObject({
    action: z.enum(RESOLUTIONS),
    reason: z.string().trim().min(1).max(500),
    ts: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((body) => body.action !== 'corregir' || body.ts !== undefined, {
    path: ['ts'],
    message: 'ts is required to correct the hour',
  });

export class ReviewStudentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  document: string;
}

export class ReviewScheduleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ format: 'date-time' })
  startsAt: string;
}

export class ReviewItemDto {
  @ApiProperty({ format: 'uuid', description: 'Event id made by the device' })
  id: string;
  @ApiProperty()
  deviceId: string;
  @ApiProperty({ enum: EVENT_TYPES })
  type: OfflineEventType;
  @ApiProperty({ type: Number, nullable: true })
  slot: number | null;
  @ApiProperty({ format: 'date-time', description: 'When it happened' })
  ts: string;
  @ApiProperty({ format: 'date-time' })
  receivedAt: string;
  @ApiProperty({ enum: OUTCOMES })
  outcome: OfflineOutcome;
  @ApiProperty({ enum: OFFLINE_REVIEW_REASONS, nullable: true })
  reviewReason: OfflineReviewReason | null;
  @ApiProperty({ type: ReviewStudentDto, nullable: true })
  student: ReviewStudentDto | null;
  @ApiProperty({ type: ReviewScheduleDto, nullable: true })
  schedule: ReviewScheduleDto | null;
  @ApiProperty({
    enum: RESOLUTIONS,
    isArray: true,
    description: 'Actions valid for this event while it is pending',
  })
  actions: OfflineResolution[];
  @ApiProperty({ enum: RESOLUTIONS, nullable: true })
  resolution: OfflineResolution | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt: string | null;
  @ApiProperty({ type: String, nullable: true })
  resolutionNote: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  correctedTs: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  sessionId: string | null;
}

export class ReviewPageDto {
  @ApiProperty({ type: [ReviewItemDto] })
  items: ReviewItemDto[];
  @ApiProperty()
  total: number;
}

export class ReviewCountDto {
  @ApiProperty({ description: 'Events waiting for a person' })
  pending: number;
}

export class ResolveReviewDto {
  @ApiProperty({ enum: RESOLUTIONS })
  action: OfflineResolution;
  @ApiProperty({ maxLength: 500, description: 'Why, in the person words' })
  reason: string;
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'New instant (same Bogota day, not in the future); corregir',
  })
  ts?: string;
}

export class DeviceClockDto {
  @ApiProperty()
  deviceId: string;
  @ApiProperty({ type: [String] })
  capabilities: string[];
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Device clock minus server clock at the last hello, seconds',
  })
  clockOffsetSec: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  clockCheckedAt: string | null;
  @ApiProperty({ description: '|offset| above the threshold' })
  clockWarning: boolean;
  @ApiProperty()
  clockThresholdSec: number;
}

export function toReviewItemDto({
  record,
  student,
  schedule,
  actions,
}: ReviewItem): ReviewItemDto {
  return {
    id: record.id,
    deviceId: record.deviceId,
    type: record.type,
    slot: record.slot,
    ts: record.ts.toISOString(),
    receivedAt: record.receivedAt.toISOString(),
    outcome: record.outcome,
    reviewReason: record.reviewReason,
    student,
    schedule: schedule && {
      id: schedule.id,
      name: schedule.name,
      startsAt: schedule.startsAt.toISOString(),
    },
    actions,
    resolution: record.resolution,
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    resolutionNote: record.resolutionNote,
    correctedTs: record.correctedTs?.toISOString() ?? null,
    sessionId: record.sessionId,
  };
}

/** Outcomes each view of the screen lists. */
export const VIEW_OUTCOMES: Record<
  (typeof REVIEW_VIEWS)[number],
  OfflineOutcome[] | undefined
> = {
  pending: ['por_revisar'],
  resolved: ['aprobado', 'corregido'],
  discarded: ['descartado'],
  all: ['por_revisar', 'aprobado', 'corregido', 'descartado'],
};
