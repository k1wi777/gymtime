import { ApiProperty } from '@nestjs/swagger';

/** Documents `DeviceStatus` (GET /devices/status). */
export class DeviceStatusDto {
  @ApiProperty()
  deviceId: string;
  @ApiProperty()
  online: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastConnectedAt: string | null;
  @ApiProperty({ type: String, nullable: true })
  firmwareVersion: string | null;
  @ApiProperty({
    description:
      'Orders in pending or sent that the device has not confirmed yet',
  })
  pendingCommands: number;
  @ApiProperty({
    enum: ['legacy', 'own', 'revoked'],
    description:
      'Credential of the device: the shared DEVICE_TOKEN (legacy), its own token, or revoked (nothing accepted)',
  })
  tokenStatus: 'legacy' | 'own' | 'revoked';
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Since when the device is offline',
  })
  offlineSince: string | null;
  @ApiProperty({
    description:
      'True from the offline alert until the device reconnects (the panel shows it)',
  })
  offlineAlert: boolean;
  @ApiProperty({
    description: 'DEVICE_OFFLINE_ALERT_MINUTES (0 = alerts disabled)',
  })
  alertThresholdMinutes: number;
}
