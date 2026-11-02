import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../common/auth/api-key.guard.js';
import { STUDENTS_REPOSITORY } from './domain/students.repository.js';
import { PrismaStudentsRepository } from './infrastructure/prisma-students.repository.js';
import { StudentsController } from './students.controller.js';
import { StudentsService } from './students.service.js';

@Module({
  controllers: [StudentsController],
  providers: [
    { provide: STUDENTS_REPOSITORY, useClass: PrismaStudentsRepository },
    ApiKeyGuard,
    StudentsService,
  ],
  exports: [StudentsService],
})
export class StudentsModule {}
