import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DISPLAY_DEFAULTS,
  generateDisplayName,
  validateDisplayLines,
} from '@gymtime/shared';
import { currentActor } from '../common/audit/actor.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { CONSENT_VERSION } from './consent.js';
import { DisplayValidationError } from '../common/display/display.errors.js';
import {
  DISPLAY_CONFIG,
  type DisplayConfig,
} from '../config/display.config.js';
import type {
  ConsentRecord,
  NewStudent,
  Student,
  StudentFilter,
  StudentPatch,
} from './domain/student.js';
import {
  STUDENTS_REPOSITORY,
  type StudentsRepository,
} from './domain/students.repository.js';

export type DeactivationListener = (student: Student) => Promise<void> | void;

/**
 * `displayName`, `email` and `phone` are optional on creation. `consented:
 * true` is a shortcut that records the consent of the current text version.
 */
export type CreateStudentInput = Omit<
  NewStudent,
  'displayName' | 'email' | 'phone' | 'consent'
> &
  Partial<Pick<NewStudent, 'displayName' | 'email' | 'phone'>> & {
    consented?: boolean;
  };

/** Same shortcut when editing; consent can be given, never withdrawn here. */
export type UpdateStudentInput = StudentPatch & { consented?: true };

/** The consent version offered is not the current text (409 CONSENT_VERSION_STALE). */
export class ConsentVersionStaleError extends Error {
  constructor(readonly current: string) {
    super(
      `El texto de consentimiento cambió; la versión vigente es ${current}`,
    );
  }
}

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);
  private readonly listeners: DeactivationListener[] = [];

  constructor(
    @Inject(STUDENTS_REPOSITORY)
    private readonly repository: StudentsRepository,
    private readonly eventLog: EventLogService,
    @Inject(DISPLAY_CONFIG) private readonly display: DisplayConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * @throws DuplicateDocumentError when the document already exists.
   * @throws DisplayValidationError when `displayName` does not fit the screen.
   */
  async create(input: CreateStudentInput): Promise<Student> {
    const displayName = input.displayName
      ? this.checkDisplayName(input.displayName)
      : generateDisplayName(input.name, this.display.cols);
    const { consented, ...fields } = input;
    const student = await this.repository.create({
      ...fields,
      email: input.email ?? null,
      phone: input.phone ?? null,
      displayName,
      consent: consented ? this.currentConsent() : null,
    });
    // Only ids and field names: contact data never goes to the audit detail.
    await this.eventLog.record('student.created', { studentId: student.id });
    if (student.consented) await this.auditConsent(student);
    return student;
  }

  /**
   * Creates the students of a CSV import in one go (all or none), without
   * consent. Fields were validated by the caller; the display name is
   * generated when missing.
   * @throws DuplicateDocumentError when any document already exists.
   */
  createMany(
    inputs: Array<
      Omit<NewStudent, 'displayName' | 'consent'> & { displayName?: string }
    >,
    importBatchId: string,
  ): Promise<Student[]> {
    return this.repository.createMany(
      inputs.map((input) => ({
        ...input,
        displayName: input.displayName
          ? this.checkDisplayName(input.displayName)
          : generateDisplayName(input.name, this.display.cols),
        importBatchId,
      })),
    );
  }

  /** Exact lookup by document, any state (bulk assignment, CSV import). */
  findByDocuments(documents: string[]): Promise<Student[]> {
    return this.repository.findByDocuments(documents);
  }

  /** Checks a display name against the screen without storing it. */
  validateDisplayName(value: string): string {
    return this.checkDisplayName(value);
  }

  /**
   * Records the consent of `version` for a student; idempotent when that
   * version is already recorded. Returns null when the student is missing.
   * @throws ConsentVersionStaleError when `version` is not the current text.
   */
  async recordConsent(id: string, version: string): Promise<Student | null> {
    if (version !== CONSENT_VERSION) {
      throw new ConsentVersionStaleError(CONSENT_VERSION);
    }
    const before = await this.repository.findById(id);
    if (!before) return null;
    if (before.consentVersion === version) return before;
    const student = await this.repository.recordConsent(
      id,
      this.currentConsent(),
    );
    if (student) await this.auditConsent(student);
    return student;
  }

  findById(id: string): Promise<Student | null> {
    return this.repository.findById(id);
  }

  /** Existing students among `ids`, any state, in no particular order. */
  findByIds(ids: string[]): Promise<Student[]> {
    return this.repository.findByIds(ids);
  }

  list(filter: StudentFilter = {}): Promise<Student[]> {
    return this.repository.findAll(filter);
  }

  /**
   * A new `name` regenerates the display name unless it was customised (it
   * differs from the one generated for the previous name).
   * @throws DisplayValidationError when `displayName` does not fit the screen.
   */
  async update(id: string, input: UpdateStudentInput): Promise<Student | null> {
    const before = await this.repository.findById(id);
    if (!before) return null;
    const { consented, ...patch } = input;
    const data: StudentPatch = { ...patch };
    if (patch.displayName !== undefined) {
      data.displayName = this.checkDisplayName(patch.displayName);
    } else if (patch.name !== undefined && this.isGenerated(before)) {
      data.displayName = generateDisplayName(patch.name, this.display.cols);
    }
    let student =
      Object.keys(data).length > 0
        ? await this.repository.update(id, data)
        : before;
    if (student && Object.keys(patch).length > 0) {
      await this.eventLog.record('student.updated', {
        studentId: id,
        fields: Object.keys(patch),
      });
    }
    if (student && consented && student.consentVersion !== CONSENT_VERSION) {
      student = await this.recordConsent(id, CONSENT_VERSION);
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

  private currentConsent(): ConsentRecord {
    const actor = currentActor();
    return {
      version: CONSENT_VERSION,
      at: this.clock.now(),
      by: actor.type === 'user' ? actor.id : null,
    };
  }

  private auditConsent(student: Student): Promise<void> {
    return this.eventLog.record('student.consent_recorded', {
      studentId: student.id,
      version: student.consentVersion,
    });
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
