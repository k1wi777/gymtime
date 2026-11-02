import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NewStudent, Student, StudentPatch } from './domain/student.js';
import {
  STUDENTS_REPOSITORY,
  type StudentsRepository,
} from './domain/students.repository.js';

export type DeactivationListener = (student: Student) => Promise<void> | void;

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);
  private readonly listeners: DeactivationListener[] = [];

  constructor(
    @Inject(STUDENTS_REPOSITORY)
    private readonly repository: StudentsRepository,
  ) {}

  /** @throws DuplicateDocumentError when the document already exists. */
  create(data: NewStudent): Promise<Student> {
    return this.repository.create(data);
  }

  findById(id: string): Promise<Student | null> {
    return this.repository.findById(id);
  }

  list(filter: { active?: boolean } = {}): Promise<Student[]> {
    return this.repository.findAll(filter);
  }

  update(id: string, patch: StudentPatch): Promise<Student | null> {
    return this.repository.update(id, patch);
  }

  /**
   * Extension point so other modules clean up after a deactivation without
   * `students` depending on them.
   */
  onDeactivated(listener: DeactivationListener): void {
    this.listeners.push(listener);
  }

  /**
   * Logical deactivation, idempotent. A failing listener does not undo it
   * (the student stays blocked); repeating the call retries the cleanup.
   */
  async deactivate(id: string): Promise<Student | null> {
    const student = await this.repository.deactivate(id);
    if (!student) return null;
    for (const listener of this.listeners) {
      try {
        await listener(student);
      } catch (error) {
        this.logger.error({
          event: 'deactivation_cleanup_failed',
          studentId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return student;
  }
}
