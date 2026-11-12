import type { AttendanceSource } from '../../attendance/domain/attendance-session.js';
import { ATTENDANCE_SOURCES } from '../../attendance/dto/attendance.dto.js';
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { AlarmStatusDto } from '../../alarm/dto/alarm.dto.js';
import { fromBogota, toBogotaParts } from '../../common/time/bogota.js';

export const SESSION_STATUS_VALUES = [
  'abierta',
  'cerrada',
  'no_registrada',
] as const;
export const ROSTER_PHASES = ['past', 'current', 'future'] as const;
export const ROSTER_STATES = ['attended', 'missing', 'expected'] as const;

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day (rejects 2026-02-31, which `Date` would roll over). */
const isRealDate = (value: string): boolean =>
  DATE_SHAPE.test(value) &&
  toBogotaParts(fromBogota(value, '00:00')).date === value;

export const rosterQuerySchema = z.strictObject({
  date: z.string().refine(isRealDate, 'expected a real date as YYYY-MM-DD'),
});

export class PanelPersonDto {
  @ApiProperty({ format: 'uuid' })
  studentId: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  document: string;
  @ApiProperty({ description: 'Short name drawn on the reader screen' })
  displayName: string;
  @ApiProperty()
  hasFingerprint: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  enteredAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  exitedAt: string | null;
  @ApiProperty({ enum: ATTENDANCE_SOURCES, nullable: true })
  source: AttendanceSource | null;
  @ApiProperty({ enum: SESSION_STATUS_VALUES, nullable: true })
  sessionStatus: (typeof SESSION_STATUS_VALUES)[number] | null;
}

export class PanelCurrentDto {
  @ApiProperty({ format: 'uuid' })
  scheduleId: string;
  @ApiProperty()
  scheduleName: string;
  @ApiProperty({ format: 'uuid' })
  instanceId: string;
  @ApiProperty({ format: 'date-time' })
  startsAt: string;
  @ApiProperty({ format: 'date-time' })
  endsAt: string;
  @ApiProperty({ format: 'date-time' })
  entryClosesAt: string;
  @ApiProperty({ description: 'True while new entries are still accepted' })
  entryOpen: boolean;
  @ApiProperty({ description: 'Seconds until endsAt, never negative' })
  remainingSeconds: number;
}

export class PanelCountsDto {
  @ApiProperty()
  expected: number;
  @ApiProperty()
  inside: number;
  @ApiProperty()
  exited: number;
  @ApiProperty()
  missing: number;
}

export class PanelNowDto {
  @ApiProperty({ format: 'date-time', description: 'Server clock' })
  serverNow: string;
  @ApiProperty({ type: PanelCurrentDto, nullable: true })
  current: PanelCurrentDto | null;
  @ApiProperty({ type: PanelCountsDto })
  counts: PanelCountsDto;
  @ApiProperty({ type: [PanelPersonDto] })
  inside: PanelPersonDto[];
  @ApiProperty({ type: [PanelPersonDto] })
  exited: PanelPersonDto[];
  @ApiProperty({ type: [PanelPersonDto] })
  missing: PanelPersonDto[];
  @ApiProperty({ type: AlarmStatusDto })
  alarm: AlarmStatusDto;
}

export class RosterOccurrenceDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Null when the occurrence is only projected from the schedule (not generated yet)',
  })
  instanceId: string | null;
  @ApiProperty({ example: '2026-11-02' })
  date: string;
  @ApiProperty({ format: 'date-time' })
  startsAt: string;
  @ApiProperty({ format: 'date-time' })
  endsAt: string;
}

export class RosterRowDto extends PanelPersonDto {
  @ApiProperty({ enum: ROSTER_STATES })
  state: (typeof ROSTER_STATES)[number];
  @ApiProperty({
    description: 'False for someone who attended without being assigned',
  })
  assigned: boolean;
}

export class RosterCountsDto {
  @ApiProperty({ description: 'Who had to attend' })
  expected: number;
  @ApiProperty()
  attended: number;
  @ApiProperty()
  missing: number;
}

export class RosterDto {
  @ApiProperty({ format: 'uuid' })
  scheduleId: string;
  @ApiProperty()
  scheduleName: string;
  @ApiProperty({ example: '2026-11-02' })
  date: string;
  @ApiProperty({
    type: RosterOccurrenceDto,
    nullable: true,
    description: 'Null when the schedule has no occurrence on that date',
  })
  occurrence: RosterOccurrenceDto | null;
  @ApiProperty({ enum: ROSTER_PHASES, nullable: true })
  phase: (typeof ROSTER_PHASES)[number] | null;
  @ApiProperty({ type: RosterCountsDto })
  counts: RosterCountsDto;
  @ApiProperty({ type: [RosterRowDto] })
  rows: RosterRowDto[];
}

export class PanelFingerprintsDto {
  @ApiProperty({
    type: [String],
    description: 'Students with an active fingerprint',
  })
  studentIds: string[];
}
