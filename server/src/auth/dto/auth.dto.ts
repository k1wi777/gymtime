import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import type { Account } from '../account.js';
import { PANEL_ROLES, type PanelRole } from '../domain/panel-user.js';

// Upper bounds only stop absurd payloads from reaching the hasher; the real
// password rules are applied by the service.
export const loginSchema = z.strictObject({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(256),
});

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(512),
});

export class LoginDto {
  @ApiProperty()
  username: string;
  @ApiProperty({ format: 'password' })
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty({ format: 'password' })
  currentPassword: string;
  @ApiProperty({ format: 'password', minLength: 10, maxLength: 128 })
  newPassword: string;
}

export class AccountResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  name: string;
  @ApiProperty()
  username: string;
  @ApiProperty({ enum: PANEL_ROLES })
  role: PanelRole;
  @ApiProperty()
  active: boolean;
  @ApiProperty({ description: 'The next request must be a password change' })
  mustChangePassword: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastLoginAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;
}

export function toAccountResponse(account: Account): AccountResponseDto {
  return {
    id: account.id,
    name: account.name,
    username: account.username,
    role: account.role,
    active: account.active,
    mustChangePassword: account.mustChangePassword,
    lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
  };
}
