import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { z } from 'zod';
import { API_KEY_HEADER, ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import {
  AttendanceService,
  type SessionView,
} from './attendance.service.js';
import { AttendanceError } from './domain/attendance.errors.js';
import type { AttendanceSession } from './domain/attendance-session.js';
import {
  ManualAttendanceDto,
  OpenSessionDto,
  SESSION_STATUSES,
  SessionDto,
  manualAttendanceSchema,
  sessionQuerySchema,
  toOpenSessionDto,
  toSessionDto,
} from './dto/attendance.dto.js';

@ApiTags('attendance')
@ApiHeader({ name: API_KEY_HEADER, required: true })
@ApiUnauthorizedResponse({ description: 'Missing or invalid API key' })
@UseGuards(ApiKeyGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('open')
  @ApiOperation({ summary: 'Students who are inside right now' })
  @ApiOkResponse({ type: [OpenSessionDto] })
  async open(): Promise<OpenSessionDto[]> {
    return (await this.attendance.listOpen()).map(toOpenSessionDto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Attendance sessions with optional filters' })
  @ApiQuery({ name: 'studentId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'instanceId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: SESSION_STATUSES })
  @ApiQuery({ name: 'from', required: false, format: 'date-time' })
  @ApiQuery({ name: 'to', required: false, format: 'date-time' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 200 })
  @ApiOkResponse({ type: [SessionDto] })
  @ApiBadRequestResponse({ description: 'Invalid query' })
  async sessions(
    @Query(new ZodValidationPipe(sessionQuerySchema))
    query: z.infer<typeof sessionQuerySchema>,
  ): Promise<SessionDto[]> {
    const { from, to, ...rest } = query;
    const sessions = await this.attendance.listSessions({
      ...rest,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    return sessions.map(toSessionDto);
  }

  @Post('entry')
  @ApiOperation({ summary: 'Register an entry manually (reason mandatory)' })
  @ApiBody({ type: ManualAttendanceDto })
  @ApiCreatedResponse({ type: SessionDto })
  @ApiNotFoundResponse({ description: 'Student not found' })
  @ApiConflictResponse({ description: 'Rule violation; body carries the code' })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  async entry(
    @Body(new ZodValidationPipe(manualAttendanceSchema))
    body: z.infer<typeof manualAttendanceSchema>,
  ): Promise<SessionDto> {
    return this.run(() =>
      this.attendance.registerManualEntry(body.studentId, body.reason),
    );
  }

  @Post('exit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Register an exit manually (reason mandatory)' })
  @ApiBody({ type: ManualAttendanceDto })
  @ApiOkResponse({ type: SessionDto })
  @ApiNotFoundResponse({ description: 'Student not found' })
  @ApiConflictResponse({ description: 'Rule violation; body carries the code' })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  async exit(
    @Body(new ZodValidationPipe(manualAttendanceSchema))
    body: z.infer<typeof manualAttendanceSchema>,
  ): Promise<SessionDto> {
    return this.run(() =>
      this.attendance.registerManualExit(body.studentId, body.reason),
    );
  }

  private async run(
    action: () => Promise<AttendanceSession>,
  ): Promise<SessionDto> {
    try {
      return toSessionDto(await this.sessionView(await action()));
    } catch (error) {
      if (!(error instanceof AttendanceError)) throw error;
      if (error.code === 'STUDENT_NOT_FOUND') {
        throw new NotFoundException(error.message);
      }
      throw new ConflictException({ code: error.code, message: error.message });
    }
  }

  /** Reloads the session through the read model so the response has its views. */
  private async sessionView(session: AttendanceSession): Promise<SessionView> {
    const sessions = await this.attendance.listSessions({
      studentId: session.studentId,
    });
    const view = sessions.find((s) => s.id === session.id);
    if (!view) throw new Error('registered session not found in the read model');
    return view;
  }
}
