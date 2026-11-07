import { Module } from '@nestjs/common';
import { CLOCK, systemClock } from '../common/time/clock.js';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { CONSENT, loadConsent, warnIfProvisional } from './consent.loader.js';
import { STUDENTS_REPOSITORY } from './domain/students.repository.js';
import { PrismaStudentsRepository } from './infrastructure/prisma-students.repository.js';
import { IMPORT_BATCHES_REPOSITORY } from './import/import-batches.repository.js';
import { PrismaImportBatchesRepository } from './import/prisma-import-batches.repository.js';
import { StudentImportController } from './import/student-import.controller.js';
import { StudentImportService } from './import/student-import.service.js';
import { StudentsController } from './students.controller.js';
import { StudentsService } from './students.service.js';

@Module({
  controllers: [StudentsController, StudentImportController],
  providers: [
    { provide: STUDENTS_REPOSITORY, useClass: PrismaStudentsRepository },
    { provide: CLOCK, useValue: systemClock },
    {
      provide: CONSENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const consent = loadConsent(
          config.get('CONSENT_FILE', { infer: true }),
        );
        warnIfProvisional(
          consent,
          config.get('NODE_ENV', { infer: true }) === 'production',
        );
        return consent;
      },
    },
    {
      provide: IMPORT_BATCHES_REPOSITORY,
      useClass: PrismaImportBatchesRepository,
    },
    StudentsService,
    StudentImportService,
  ],
  exports: [StudentsService],
})
export class StudentsModule {}
