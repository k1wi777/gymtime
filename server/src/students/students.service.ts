import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DISPLAY_DEFAULTS,
  generateDisplayName,
  validateDisplayLines,
} from '@gymtime/shared';
import { EventLogService } from '../common/audit/event-log.service.js';
import { DisplayValidationError } from '../common/display/display.errors.js';
import {
  DISPLAY_CONFIG,
  type DisplayConfig,
} from '../config/display.config.js';
import type { NewStudent, Student, StudentPatch } from './domain/student.js';
import {
  STUDENTS_REPOSITORY,
  type StudentsRepository,
} from './domain/students.repository.js';

export type DeactivationListener = (student: Student) => Promise<void> | void;

/** `displayName`, `email` and `phone` are optional on creation. */
export type CreateStudentInput = Omit<
  NewStudent,
  'displayName' | 'email' | 'phone'
> &
  Partial<Pick<NewStudent, 'displayName' | 'email' | 'phone'>>;

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);
  private readonly listeners: DeactivationListener[] = [];

  constructor(
    @Inject(STUDENTS_REPOSITORY)
    private readonly repository: StudentsRepository,
    private readonly eventLog: EventLogService,
    @Inject(DISPLAY_CONFIG) private readonly display: DisplayConfig,
  ) {}

  /**
   * @throws DuplicateDocumentError when the document already exists.
   * @throws DisplayValidationError when `displayName` does not fit the screen.
   */
  async create(input: CreateStudentInput): Promise<Student> {
    const displayName = input.displayName
      ? this.checkDisplayName(input.displayName)
      : generateDisplayName(input.name, this.display.cols);
    const student = await this.repository.create({
      ...input,
      email: input.email ?? null,
      phone: input.phone ?? null,
      displayName,
    });
    // Only ids and field names: contact data never goes to the audit detail.
    await this.eventLog.record('student.created', { studentId: student.id });
    return student;
  }

  findById(id: string): Promise<Student | null> {
    return this.repository.findById(id);
  }

  /** Existing students among `ids`, any state, in no particular order. */
  findByIds(ids: string[]): Promise<Student[]> {
    return this.repository.findByIds(ids);
  }

  list(filter: { active?: boolean } = {}): Promise<Student[]> {
    return this.repository.findAll(filter);
  }

  /**
   * A new `name` regenerates the display name unless it was customised (it
   * differs from the one generated for the previous name).
   * @throws DisplayValidationError when `displayName` does not fit the screen.
   */
  async update(id: string, patch: StudentPatch): Promise<Student | null> {
    const before = await this.repository.findById(id);
    if (!before) return null;
    const data: StudentPatch = { ...patch };
    if (patch.displayName !== undefined) {
      data.displayName = this.checkDisplayName(patch.displayName);
    } else if (patch.name !== undefined && this.isGenerated(before)) {
      data.displayName = generateDisplayName(patch.name, this.display.cols);
    }
    const student = await this.repository.update(id, data);
    if (student) {
      await this.eventLog.record('student.updated', {
        studentId: id,
        fields: Object.keys(patch),
      });
    }
    return student;
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
    await this.eventLog.record('student.deactivated', { studentId: id });
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

  private checkDisplayName(value: string): string {
    const checked = validateDisplayLines([value], {
      cols: this.display.cols,
      rows: 1,
    });
    if (!checked.ok) throw new DisplayValidationError(checked.errors);
    if (checked.lines[0] === '') {
      throw new DisplayValidationError([
        { line: 1, limit: null, message: 'displayName cannot be empty' },
      ]);
    }
    return checked.lines[0];
  }

  /** Stored names built before DISPLAY_COLS changed use the default width. */
  private isGenerated(student: Student): boolean {
    return [this.display.cols, DISPLAY_DEFAULTS.cols].some(
      (cols) => student.displayName === generateDisplayName(student.name, cols),
    );
  }
}
