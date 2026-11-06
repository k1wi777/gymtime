import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { RegenerationDto } from '../dto/schedule.dto.js';
import type { ExceptionResult, PeriodDetail } from './periods.service.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = z
  .string()
  .regex(DATE, 'expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'not a real date',
  });
const name = z.string().trim().min(1).max(100);
const reason = z.string().trim().min(1).max(200);

export const createPeriodSchema = z.strictObject({
  name,
  startDate: date,
  endDate: date,
});

export const updatePeriodSchema = z
  .strictObject({
    name: name.optional(),
    startDate: date.optional(),
    endDate: date.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'no fields to update');

export const createExceptionSchema = z.strictObject({
  from: date,
  to: date,
  reason,
});

export const updateExceptionSchema = z
  .strictObject({
    from: date.optional(),
    to: date.optional(),
    reason: reason.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'no fields to update');

export class CreatePeriodDto {
  @ApiProperty({ example: '2026-2' })
  name: string;
  @ApiProperty({ example: '2026-08-03', description: 'Bogota date' })
  startDate: string;
  @ApiProperty({ example: '2026-11-27', description: 'Bogota date' })
  endDate: string;
}

export class UpdatePeriodDto {
  @ApiPropertyOptional()
  name?: string;
  @ApiPropertyOptional({ example: '2026-08-03' })
  startDate?: string;
  @ApiPropertyOptional({ example: '2026-11-27' })
  endDate?: string;
}

export class CreateExceptionDto {
  @ApiProperty({ example: '2026-10-12' })
  from: string;
  @ApiProperty({ example: '2026-10-12', description: 'Inclusive' })
  to: string;
  @ApiProperty({ example: 'Festivo' })
  reason: string;
}

export class UpdateExceptionDto {
  @ApiPropertyOptional()
  from?: string;
  @ApiPropertyOptional()
  to?: string;
  @ApiPropertyOptional()
  reason?: string;
}

export class ServiceExceptionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty({ example: '2026-10-12' })
  from: string;
  @ApiProperty({ example: '2026-10-12' })
  to: string;
  @ApiProperty()
  reason: string;
}

export class PeriodResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty({ example: '2026-08-03' })
  startDate: string;
  @ApiProperty({ example: '2026-11-27' })
  endDate: string;
  @ApiProperty({ description: 'At most one period is active' })
  active: boolean;
  @ApiProperty({ type: [ServiceExceptionDto] })
  exceptions: ServiceExceptionDto[];
  @ApiProperty({ description: 'Recurring schedules of the period' })
  schedulesCount: number;
  @ApiPropertyOptional({
    type: RegenerationDto,
    description: 'Only when changing the dates regenerated occurrences',
  })
  regeneration?: RegenerationDto;
}

export class ExceptionResultDto {
  @ApiProperty({ type: ServiceExceptionDto })
  exception: ServiceExceptionDto;
  @ApiProperty({ type: RegenerationDto })
  regeneration: RegenerationDto;
}

export function toPeriodResponse(detail: PeriodDetail): PeriodResponseDto {
  return {
    ...detail.period,
    exceptions: detail.exceptions.map(({ id, from, to, reason }) => ({
      id,
      from,
      to,
      reason,
    })),
    schedulesCount: detail.schedulesCount,
    ...(detail.regeneration && { regeneration: detail.regeneration }),
  };
}

export function toExceptionResult(result: ExceptionResult): ExceptionResultDto {
  const { id, from, to, reason } = result.exception;
  return {
    exception: { id, from, to, reason },
    regeneration: result.regeneration,
  };
}
