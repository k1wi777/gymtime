import { ApiProperty } from '@nestjs/swagger';
import { ALARM_REASONS } from '@gymtime/shared';
import type {
  AlarmClosedBy,
  AlarmOffResult,
  AlarmReason,
  AlarmStatus,
} from '../domain/alarm-event.js';

export const ALARM_CLOSED_BY = [
  'all_exited',
  'button',
  'cli',
  'timeout',
] as const;

export class AlarmStatusDto {
  @ApiProperty()
  on: boolean;

  @ApiProperty({ enum: ALARM_REASONS, nullable: true })
  reason: AlarmReason | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  instanceId: string | null;

  @ApiProperty({ type: Number, nullable: true })
  durationSec: number | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  startedAt: string | null;

  @ApiProperty()
  openSessions: number;
}

export class AlarmOffResultDto {
  @ApiProperty({ enum: ALARM_CLOSED_BY })
  closedBy: AlarmClosedBy;

  @ApiProperty()
  sessionsClosed: number;

  @ApiProperty({ type: AlarmStatusDto })
  status: AlarmStatusDto;
}

export function toAlarmStatusDto(status: AlarmStatus): AlarmStatusDto {
  return {
    on: status.on,
    reason: status.reason,
    instanceId: status.instanceId,
    durationSec: status.durationSec,
    startedAt: status.startedAt?.toISOString() ?? null,
    openSessions: status.openSessions,
  };
}

export function toAlarmOffResultDto(result: AlarmOffResult): AlarmOffResultDto {
  return {
    closedBy: result.closedBy,
    sessionsClosed: result.sessionsClosed,
    status: toAlarmStatusDto(result.status),
  };
}
