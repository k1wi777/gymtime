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
}
