import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/** Same character set the firmware uses for its id; no spaces or slashes. */
export const deviceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, 'letters, digits, dot, dash or underscore');

export const registerDeviceSchema = z.object({ deviceId: deviceIdSchema });

export class RegisterDeviceDto {
  @ApiProperty({ example: 'esp32-01', maxLength: 64 })
  deviceId: string;
}

export class IssuedTokenDto {
  @ApiProperty()
  deviceId: string;
  @ApiProperty({
    description:
      'Shown only in this response (Cache-Control: no-store); the server keeps just its hash',
  })
  token: string;
}

export class RevokedTokenDto {
  @ApiProperty()
  deviceId: string;
  @ApiProperty({ enum: ['revoked'] })
  tokenStatus: 'revoked';
}
