import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SYSTEM_EVENT_TYPES } from '../common/events/system-event.js';
import {
  createStudentSchema,
  updateStudentSchema,
} from '../students/dto/student.dto.js';
import { createUserSchema, updateUserSchema } from '../users/dto/users.dto.js';
import { changePasswordSchema, loginSchema } from '../auth/dto/auth.dto.js';
import { manualAttendanceSchema } from '../attendance/dto/attendance.dto.js';
import { sendMessageSchema } from '../devices/dto/display.dto.js';
import {
  assignBodySchema,
  bulkAssignSchema,
  copyStudentsSchema,
  createScheduleSchema,
  updateScheduleSchema,
} from '../schedules/dto/schedule.dto.js';
import {
  createExceptionSchema,
  createPeriodSchema,
  updateExceptionSchema,
  updatePeriodSchema,
} from '../schedules/periods/periods.dto.js';
import { consentBodySchema } from '../students/dto/student.dto.js';
import {
  importSchema,
  previewSchema,
} from '../students/import/student-import.dto.js';
import { startEnrollmentSchema } from '../fingerprints/dto/enrollment.dto.js';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: 'device-token-123456',
  ADMIN_API_KEY: 'admin-key-1234567890',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

const { AppModule } = await import('../app.module.js');
const { PrismaService } = await import('../database/prisma.service.js');
const { buildOpenApiDocument, serializeOpenApi } =
  await import('./build-document.js');
const { OPENAPI_FILE } = await import('./openapi-file.js');

type Schema = {
  properties?: Record<string, unknown>;
  required?: string[];
};

describe('OpenAPI document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    // Providers are only constructed (never initialized), so no database is needed.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    document = buildOpenApiDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('matches the versioned server/openapi.json', () => {
    const versioned = readFileSync(OPENAPI_FILE, 'utf8');
    expect(
      serializeOpenApi(document) === versioned,
      'server/openapi.json is out of date: run `npm --prefix server run openapi:export` and commit it',
    ).toBe(true);
  });

  it('gives every 4xx answer the common error body', () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const responses = (operation as { responses?: Record<string, object> })
          .responses;
        for (const [status, response] of Object.entries(responses ?? {})) {
          const content = (response as { content?: object }).content;
          if (/^4/.test(status) && !content) {
            missing.push(`${method.toUpperCase()} ${path} ${status}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('declares a body schema for every success answer except 204', () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const responses =
          (operation as { responses?: Record<string, object> }).responses ?? {};
        for (const [status, response] of Object.entries(responses)) {
          const content = (response as { content?: object }).content;
          if (/^2/.test(status) && status !== '204' && !content) {
            missing.push(`${method.toUpperCase()} ${path} ${status}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('describes every event type of GET /events with a discriminator', () => {
    const operation = document.paths['/events']?.get as {
      responses: Record<
        string,
        {
          content?: Record<
            string,
            {
              schema: {
                oneOf: unknown[];
                discriminator: { mapping: Record<string, string> };
              };
            }
          >;
        }
      >;
    };
    const schema =
      operation.responses['200']?.content?.['text/event-stream']?.schema;
    expect(schema?.oneOf).toHaveLength(SYSTEM_EVENT_TYPES.length);
    expect(Object.keys(schema?.discriminator.mapping ?? {}).sort()).toEqual(
      [...SYSTEM_EVENT_TYPES].sort(),
    );
    expect(document.components?.schemas).toHaveProperty('AttendanceEventDto');
    expect(document.components?.schemas).toHaveProperty('EnrollmentEventDto');
  });

  describe('request schemas stay in step with the zod validators', () => {
    const PAIRS: Array<[string, z.ZodType, string]> = [
      ['LoginDto', loginSchema, 'LoginDto'],
      ['ChangePasswordDto', changePasswordSchema, 'ChangePasswordDto'],
      ['CreateUserDto', createUserSchema, 'CreateUserDto'],
      ['UpdateUserDto', updateUserSchema, 'UpdateUserDto'],
      ['CreateStudentDto', createStudentSchema, 'CreateStudentDto'],
      ['UpdateStudentDto', updateStudentSchema, 'UpdateStudentDto'],
      ['ManualAttendanceDto', manualAttendanceSchema, 'ManualAttendanceDto'],
      ['SendMessageDto', sendMessageSchema, 'SendMessageDto'],
      ['CreateScheduleDto', createScheduleSchema, 'CreateScheduleDto'],
      ['StartEnrollmentDto', startEnrollmentSchema, 'StartEnrollmentDto'],
      ['UpdateScheduleDto', updateScheduleSchema, 'UpdateScheduleDto'],
      ['AssignStudentDto', assignBodySchema, 'AssignStudentDto'],
      ['BulkAssignDto', bulkAssignSchema, 'BulkAssignDto'],
      ['CopyStudentsDto', copyStudentsSchema, 'CopyStudentsDto'],
      ['CreatePeriodDto', createPeriodSchema, 'CreatePeriodDto'],
      ['UpdatePeriodDto', updatePeriodSchema, 'UpdatePeriodDto'],
      ['CreateExceptionDto', createExceptionSchema, 'CreateExceptionDto'],
      ['UpdateExceptionDto', updateExceptionSchema, 'UpdateExceptionDto'],
      ['RecordConsentDto', consentBodySchema, 'RecordConsentDto'],
      ['PreviewDto', previewSchema, 'PreviewDto'],
      ['ImportDto', importSchema, 'ImportDto'],
    ];

    it.each(PAIRS)('%s', (_name, schema, dto) => {
      const fromZod = z.toJSONSchema(schema, {
        io: 'input',
        unrepresentable: 'any',
      }) as Schema;
      const fromDto = document.components?.schemas?.[dto] as Schema;
      expect(fromDto, `${dto} is not in the document`).toBeDefined();
      expect(Object.keys(fromDto.properties ?? {}).sort()).toEqual(
        Object.keys(fromZod.properties ?? {}).sort(),
      );
      expect([...(fromDto.required ?? [])].sort()).toEqual(
        [...(fromZod.required ?? [])].sort(),
      );
    });
  });
});
