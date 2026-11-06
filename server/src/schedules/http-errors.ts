import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ScheduleHasAttendanceError,
  ScheduleOverlapError,
  ScheduleValidationError,
} from './domain/schedule.js';
import { PeriodError } from './periods/period.js';
import { ScheduleLookupFailed } from './schedules.service.js';

/**
 * Maps the business failures of periods and schedules to HTTP. The `code` is
 * stable for the panel; `message` is Spanish text it may show as is.
 */
export function mapScheduleError(error: unknown): unknown {
  if (error instanceof ScheduleValidationError) {
    return new BadRequestException(error.message);
  }
  if (error instanceof ScheduleLookupFailed) {
    return new NotFoundException(error.message);
  }
  if (error instanceof ScheduleOverlapError) {
    return new ConflictException({
      statusCode: 409,
      code: 'SCHEDULE_OVERLAP',
      message: error.message,
      conflict: error.conflict,
    });
  }
  if (error instanceof ScheduleHasAttendanceError) {
    return new ConflictException({
      statusCode: 409,
      code: 'SCHEDULE_HAS_ATTENDANCE',
      message: error.message,
    });
  }
  if (error instanceof PeriodError) {
    const body = {
      code: error.code,
      message: error.message,
      ...error.details,
    };
    switch (error.code) {
      case 'PERIOD_NOT_FOUND':
      case 'EXCEPTION_NOT_FOUND':
        return new NotFoundException(body);
      case 'INVALID_RANGE':
      case 'EXCEPTION_OUT_OF_PERIOD':
        return new BadRequestException(body);
      default:
        return new ConflictException({ statusCode: 409, ...body });
    }
  }
  return error;
}
