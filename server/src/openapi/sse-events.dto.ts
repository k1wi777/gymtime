import type { AttendanceSource } from '../attendance/domain/attendance-session.js';
import { ATTENDANCE_SOURCES } from '../attendance/dto/attendance.dto.js';
import { ApiProperty } from '@nestjs/swagger';
import { ALARM_REASONS, REJECT_REASONS, SCAN_RESULTS } from '@gymtime/shared';
import { ALARM_CLOSED_BY } from '../alarm/dto/alarm.dto.js';
import { ENROLLMENT_STATUSES } from '../fingerprints/domain/enrollment.js';
import type { SystemEventMap } from '../common/events/system-event.js';
import { SYSTEM_EVENT_TYPES } from '../common/events/system-event.js';

/**
 * Schemas of the frames of `GET /events`. Each data class `implements` its
 * entry of `SystemEventMap`, so the published schema cannot drift from what
 * the server emits.
 */
type Data<K extends keyof SystemEventMap> = SystemEventMap[K];

const DISCONNECT_REASONS = [
  'closed',
  'replaced',
  'heartbeat_timeout',
  'server_shutdown',
  'token_revoked',
] as const;
const COMMAND_STATUSES = ['pending', 'sent', 'acked', 'failed'] as const;

export class DeviceConnectedDataDto implements Data<'device.connected'> {
  @ApiProperty()
  deviceId: string;
  @ApiProperty()
  firmwareVersion: string;
}

export class DeviceDisconnectedDataDto implements Data<'device.disconnected'> {
  @ApiProperty()
  deviceId: string;
  @ApiProperty({ enum: DISCONNECT_REASONS })
  reason: (typeof DISCONNECT_REASONS)[number];
}

export class DeviceOfflineAlertDataDto implements Data<'device.offline_alert'> {
  @ApiProperty()
  deviceId: string;
  @ApiProperty({ description: 'Minutes offline when the alert fired' })
  offlineMinutes: number;
  @ApiProperty({
    description: 'Configured threshold (DEVICE_OFFLINE_ALERT_MINUTES)',
  })
  thresholdMinutes: number;
}

export class DeviceClockSkewDataDto implements Data<'device.clock_skew'> {
  @ApiProperty()
  deviceId: string;
  @ApiProperty({ description: 'Device clock minus server clock, in seconds' })
  offsetSec: number;
  @ApiProperty({ description: 'Configured threshold (CLOCK_OFFSET_WARN_SEC)' })
  thresholdSec: number;
  @ApiProperty({ description: 'True while |offsetSec| exceeds the threshold' })
  warning: boolean;
}

export class OfflineReviewDataDto implements Data<'offline.review'> {
  @ApiProperty({ description: 'Offline events waiting for a person' })
  pending: number;
}

export class ScanDataDto implements Data<'scan'> {
  @ApiProperty()
  deviceId: string;
  @ApiProperty({ type: Number, nullable: true })
  slot: number | null;
  @ApiProperty({ enum: SCAN_RESULTS })
  result: (typeof SCAN_RESULTS)[number];
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  studentId: string | null;
  @ApiProperty({ type: String, nullable: true })
  studentName: string | null;
  @ApiProperty({ enum: REJECT_REASONS, nullable: true })
  reason: (typeof REJECT_REASONS)[number] | null;
}

export class CommandDataDto implements Data<'command'> {
  @ApiProperty()
  deviceId: string;
  @ApiProperty({ format: 'uuid' })
  commandId: string;
  @ApiProperty({ example: 'alarm.set', description: 'Protocol message type' })
  commandType: string;
  @ApiProperty({ enum: COMMAND_STATUSES })
  status: (typeof COMMAND_STATUSES)[number];
  @ApiProperty()
  attempts: number;
}

export class AlarmDataDto implements Data<'alarm'> {
  @ApiProperty()
  on: boolean;
  @ApiProperty({ enum: ALARM_REASONS })
  reason: (typeof ALARM_REASONS)[number];
  @ApiProperty({ enum: ALARM_CLOSED_BY, nullable: true })
  closedBy: (typeof ALARM_CLOSED_BY)[number] | null;
  @ApiProperty()
  sessionsClosed: number;
}

export class AttendanceDataDto implements Data<'attendance'> {
  @ApiProperty({ enum: ['entry', 'exit'] })
  change: 'entry' | 'exit';
  @ApiProperty({ enum: ATTENDANCE_SOURCES })
  source: AttendanceSource;
  @ApiProperty({ format: 'uuid' })
  studentId: string;
  @ApiProperty()
  studentName: string;
  @ApiProperty({ format: 'uuid' })
  instanceId: string;
  @ApiProperty({ format: 'uuid' })
  sessionId: string;
}

export class EnrollmentDataDto implements Data<'enrollment'> {
  @ApiProperty({ format: 'uuid' })
  enrollmentId: string;
  @ApiProperty({ format: 'uuid' })
  studentId: string;
  @ApiProperty()
  deviceId: string;
  @ApiProperty({ enum: ENROLLMENT_STATUSES })
  status: SystemEventMap['enrollment']['status'];
  @ApiProperty({ type: String, nullable: true })
  step: string | null;
  @ApiProperty({ type: String, nullable: true })
  failureReason: string | null;
}

export class KeepaliveDataDto {}

abstract class EventEnvelope {
  @ApiProperty({ type: String, format: 'date-time' })
  at: string;
}

export class DeviceConnectedEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['device.connected'] })
  type: 'device.connected';
  @ApiProperty({ type: DeviceConnectedDataDto })
  data: DeviceConnectedDataDto;
}

export class DeviceDisconnectedEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['device.disconnected'] })
  type: 'device.disconnected';
  @ApiProperty({ type: DeviceDisconnectedDataDto })
  data: DeviceDisconnectedDataDto;
}

export class DeviceOfflineAlertEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['device.offline_alert'] })
  type: 'device.offline_alert';
  @ApiProperty({ type: DeviceOfflineAlertDataDto })
  data: DeviceOfflineAlertDataDto;
}

export class DeviceClockSkewEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['device.clock_skew'] })
  type: 'device.clock_skew';
  @ApiProperty({ type: DeviceClockSkewDataDto })
  data: DeviceClockSkewDataDto;
}

export class OfflineReviewEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['offline.review'] })
  type: 'offline.review';
  @ApiProperty({ type: OfflineReviewDataDto })
  data: OfflineReviewDataDto;
}

export class ScanEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['scan'] })
  type: 'scan';
  @ApiProperty({ type: ScanDataDto })
  data: ScanDataDto;
}

export class CommandEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['command'] })
  type: 'command';
  @ApiProperty({ type: CommandDataDto })
  data: CommandDataDto;
}

export class AlarmEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['alarm'] })
  type: 'alarm';
  @ApiProperty({ type: AlarmDataDto })
  data: AlarmDataDto;
}

export class AttendanceEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['attendance'] })
  type: 'attendance';
  @ApiProperty({ type: AttendanceDataDto })
  data: AttendanceDataDto;
}

export class EnrollmentEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['enrollment'] })
  type: 'enrollment';
  @ApiProperty({ type: EnrollmentDataDto })
  data: EnrollmentDataDto;
}

export class KeepaliveEventDto extends EventEnvelope {
  @ApiProperty({ enum: ['keepalive'] })
  type: 'keepalive';
  @ApiProperty({ type: KeepaliveDataDto })
  data: KeepaliveDataDto;
}

/** One class per event type, keyed by `type` (the discriminator of the stream). */
export const SSE_EVENT_DTOS = {
  'device.connected': DeviceConnectedEventDto,
  'device.disconnected': DeviceDisconnectedEventDto,
  'device.offline_alert': DeviceOfflineAlertEventDto,
  'device.clock_skew': DeviceClockSkewEventDto,
  'offline.review': OfflineReviewEventDto,
  scan: ScanEventDto,
  command: CommandEventDto,
  alarm: AlarmEventDto,
  attendance: AttendanceEventDto,
  enrollment: EnrollmentEventDto,
  keepalive: KeepaliveEventDto,
} as const satisfies Record<(typeof SYSTEM_EVENT_TYPES)[number], unknown>;
