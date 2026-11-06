import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { USERNAME_PATTERN, normalizeUsername } from '../../auth/username.js';
import { PANEL_ROLES, type PanelRole } from '../../auth/domain/panel-user.js';
import { AccountResponseDto } from '../../auth/dto/auth.dto.js';

const name = z.string().trim().min(1).max(100);
const role = z.enum(PANEL_ROLES);

const username = z
  .string()
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .regex(
        USERNAME_PATTERN,
        '3-50 characters: letters, digits, dot, dash or underscore',
      ),
  );

export const createUserSchema = z.strictObject({ name, username, role });

export const updateUserSchema = z
  .strictObject({
    name: name.optional(),
    role: role.optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'no fields to update');

export class CreateUserDto {
  @ApiProperty()
  name: string;
  @ApiProperty({
    description:
      'Case-insensitive, 3-50 chars: a-z, 0-9, dot, dash, underscore',
  })
  username: string;
  @ApiProperty({ enum: PANEL_ROLES })
  role: PanelRole;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  name?: string;
  @ApiPropertyOptional({ enum: PANEL_ROLES })
  role?: PanelRole;
  @ApiPropertyOptional({
    description: 'false deactivates and signs the user out',
  })
  active?: boolean;
}

export class AccountWithTemporaryPasswordDto extends AccountResponseDto {
  @ApiProperty({
    description:
      'Shown only in this response; the user must change it at first sign-in',
  })
  temporaryPassword: string;
}
