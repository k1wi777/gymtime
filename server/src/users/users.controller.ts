import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { toAccountResponse, AccountResponseDto } from '../auth/dto/auth.dto.js';
import { DuplicateUsernameError } from '../auth/domain/panel-user.js';
import { Auth, type AuthContext } from '../common/auth/auth-context.js';
import { ApiAuth, Roles } from '../common/auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  AccountWithTemporaryPasswordDto,
  CreateUserDto,
  UpdateUserDto,
  createUserSchema,
  updateUserSchema,
} from './dto/users.dto.js';
import {
  AccountNotFoundError,
  LastAdminError,
  SelfChangeError,
  UsersService,
  type CreatedAccount,
} from './users.service.js';

@ApiTags('users')
@ApiAuth()
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List the panel accounts' })
  @ApiOkResponse({ type: [AccountResponseDto] })
  async list(): Promise<AccountResponseDto[]> {
    return (await this.users.list()).map(toAccountResponse);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an account with a server-generated temporary password',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiCreatedResponse({ type: AccountWithTemporaryPasswordDto })
  @ApiConflictResponse({ description: 'USERNAME_TAKEN' })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  async create(
    @Body(new ZodValidationPipe(createUserSchema))
    body: z.infer<typeof createUserSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountWithTemporaryPasswordDto> {
    try {
      return this.withPassword(await this.users.create(body), res);
    } catch (error) {
      throw mapError(error);
    }
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit name or role, or deactivate / reactivate an account',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @ApiConflictResponse({
    description:
      'SELF_CHANGE_FORBIDDEN: own deactivation or role change; LAST_ADMIN: would leave no active administrator',
  })
  async update(
    @Auth() auth: AuthContext | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema))
    body: z.infer<typeof updateUserSchema>,
  ): Promise<AccountResponseDto> {
    try {
      return toAccountResponse(await this.users.update(auth, id, body));
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reset the password to a new temporary one and sign the user out',
  })
  @ApiOkResponse({ type: AccountWithTemporaryPasswordDto })
  @ApiNotFoundResponse({ description: 'Account not found' })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountWithTemporaryPasswordDto> {
    try {
      return this.withPassword(await this.users.resetPassword(id), res);
    } catch (error) {
      throw mapError(error);
    }
  }

  private withPassword(
    created: CreatedAccount,
    res: Response,
  ): AccountWithTemporaryPasswordDto {
    // The one-time password must not be kept by any cache.
    res.setHeader('Cache-Control', 'no-store');
    return Object.assign(toAccountResponse(created.account), {
      temporaryPassword: created.temporaryPassword,
    });
  }
}

function mapError(error: unknown): unknown {
  if (error instanceof AccountNotFoundError) {
    return new NotFoundException('Account not found');
  }
  if (error instanceof DuplicateUsernameError) {
    return new ConflictException({
      statusCode: 409,
      code: 'USERNAME_TAKEN',
      message: 'Ya existe una cuenta con ese usuario',
    });
  }
  if (error instanceof SelfChangeError) {
    return new ConflictException({
      statusCode: 409,
      code: 'SELF_CHANGE_FORBIDDEN',
      message: error.message,
    });
  }
  if (error instanceof LastAdminError) {
    return new ConflictException({
      statusCode: 409,
      code: 'LAST_ADMIN',
      message: error.message,
    });
  }
  return error;
}
