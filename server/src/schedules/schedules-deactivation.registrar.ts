import { Injectable, type OnModuleInit } from '@nestjs/common';
import { StudentsService } from '../students/students.service.js';
import { SchedulesService } from './schedules.service.js';

/**
 * Closes the schedule validity of a deactivated student (H10 defect): without
 * it the reports kept counting absences for occurrences after the
 * deactivation. `students` does not know this module.
 */
@Injectable()
export class SchedulesDeactivationRegistrar implements OnModuleInit {
  constructor(
    private readonly students: StudentsService,
    private readonly schedules: SchedulesService,
  ) {}

  onModuleInit(): void {
    this.students.onDeactivated(async (student) => {
      await this.schedules.closeStudentValidity(student.id);
    });
  }
}
