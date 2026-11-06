import { Module } from '@nestjs/common';
import { CLOCK, systemClock } from '../common/time/clock.js';
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
      provide: IMPORT_BATCHES_REPOSITORY,
      useClass: PrismaImportBatchesRepository,
    },
    StudentsService,
    StudentImportService,
  ],
  exports: [StudentsService],
})
export class StudentsModule {}
