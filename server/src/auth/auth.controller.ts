import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Auth, type AuthContext } from '../common/auth/auth-context.js';
import {
  AccountRequired,
  ApiAuth,
  Public,
} from '../common/auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import {
  InvalidCredentialsError,
  InvalidCurrentPasswordError,
  LoginRateLimitedError,
  PasswordPolicyError,
} from './auth.errors.js';
import { AuthService, type SessionContext } from './auth.service.js';
import { SESSION_COOKIE, sessionCookieOptions } from './cookie.js';
import {
  AccountResponseDto,
  ChangePasswordDto,
  LoginDto,
  changePasswordSchema,
  loginSchema,
  toAccountResponse,
} from './dto/auth.dto.js';
import { PASSWORD_PROBLEM_MESSAGE } from './password-policy.js';

/** One message for every failed sign-in: unknown user, wrong password, inactive or locked. */
const INVALID_CREDENTIALS_MESSAGE =
  'Usuario o contraseña incorrectos, o cuenta bloqueada';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in; sets the httpOnly session cookie (public)',
    description:
      'Send the `x-gymtime-client: panel` header and an allowed Origin. The failure answer is the same for every cause.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiUnauthorizedResponse({ description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED (Retry-After)' })
  async login(
    @Body(new ZodValidationPipe(loginSchema))
    body: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountResponseDto> {
    noStore(res);
    try {
      const result = await this.auth.login({
        ...body,
        ip: req.ip ?? 'unknown',
      });
      res.cookie(SESSION_COOKIE, result.token, {
        ...sessionCookieOptions(this.config.cookie),
        maxAge: result.maxAgeMs,
      });
      return toAccountResponse(result.account);
    } catch (error) {
      throw this.mapLoginError(error, res);
    }
  }

  @AccountRequired()
  @Post('logout')
  @HttpCode(204)
  @ApiAuth()
  @ApiOperation({ summary: 'Revoke the current session and clear the cookie' })
  async logout(
    @Auth() auth: AuthContext | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    noStore(res);
    const session = requireSession(auth);
    await this.auth.logout(session.sessionId);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.config.cookie));
  }

  @AccountRequired()
  @Get('me')
  @ApiAuth()
  @ApiOperation({ summary: 'Account of the current session, with its role' })
  @ApiOkResponse({ type: AccountResponseDto })
  me(
    @Auth() auth: AuthContext | undefined,
    @Res({ passthrough: true }) res: Response,
  ): AccountResponseDto {
    noStore(res);
    return toAccountResponse(requireSession(auth).account);
  }

  @AccountRequired()
  @Post('password')
  @HttpCode(200)
  @ApiAuth()
  @ApiOperation({
    summary: 'Change the own password (clears the forced change)',
    description: 'Revokes the other sessions of the account.',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiBadRequestResponse({
    description: 'Policy violation or wrong current password',
  })
  async changePassword(
    @Auth() auth: AuthContext | undefined,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: z.infer<typeof changePasswordSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountResponseDto> {
    noStore(res);
    try {
      const account = await this.auth.changePassword(
        requireSession(auth),
        body.currentPassword,
        body.newPassword,
      );
      return toAccountResponse(account);
    } catch (error) {
      throw mapPasswordError(error);
    }
  }

  private mapLoginError(error: unknown, res: Response): unknown {
    if (error instanceof InvalidCredentialsError) {
      return new UnauthorizedException({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }
    if (error instanceof LoginRateLimitedError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return new HttpException(
        {
          statusCode: 429,
          code: 'RATE_LIMITED',
          message: 'Demasiados intentos; espere antes de volver a intentar',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return error;
  }
}

const noStore = (res: Response): void => {
  res.setHeader('Cache-Control', 'no-store');
};

/** The credential of the system (`x-api-key`) has no account to act on. */
function requireSession(
  auth: AuthContext | undefined,
): SessionContext & { account: NonNullable<SessionContext['account']> } {
  if (auth?.kind !== 'session') {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'ACCOUNT_REQUIRED',
      message: 'This endpoint needs a signed-in account',
    });
  }
  return auth;
}

function mapPasswordError(error: unknown): unknown {
  if (error instanceof InvalidCurrentPasswordError) {
    return badRequest(
      'INVALID_CURRENT_PASSWORD',
      'La contraseña actual no es correcta',
    );
  }
  if (error instanceof PasswordPolicyError) {
    const message =
      error.problem === 'same_as_current'
        ? 'La nueva contraseña debe ser distinta de la actual'
        : PASSWORD_PROBLEM_MESSAGE[error.problem];
    return badRequest('PASSWORD_POLICY', message);
  }
  return error;
}

const badRequest = (code: string, message: string): HttpException =>
  new HttpException({ statusCode: 400, code, message }, HttpStatus.BAD_REQUEST);
