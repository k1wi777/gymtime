import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DISPLAY_DEFAULTS,
  generateDisplayName,
  toAscii,
  validateDisplayMessage,
} from '@gymtime/shared';
import { currentActor } from '../common/audit/actor.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import {
  CONSENT,
  PROVISIONAL_CONSENT,
  type ConsentText,
} from './consent.loader.js';
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

/** Cleanup of an erased student's data; returns how many templates it deleted. */
export type ErasureListener = (
  student: Student,
) => Promise<number | void> | number | void;

export interface ErasureResult {
  studentId: string;
  templatesDeleted: number;
}

/** The confirmation document does not match the student (409 CONFIRMATION_MISMATCH). */
export class ErasureConfirmationError extends Error {
  constructor() {
    super('El documento de confirmación no coincide con el del estudiante');
  }
}

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

const ANONYMIZED_NAME = 'Estudiante anonimizado';
const ANONYMIZED_DISPLAY_NAME = 'Anonimizado';

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);
  private readonly listeners: DeactivationListener[] = [];
  private readonly erasureListeners: ErasureListener[] = [];
  private readonly afterErasureListeners: Array<(student: Student) => void> =
    [];

  constructor(
    @Inject(STUDENTS_REPOSITORY)
    private readonly repository: StudentsRepository,
    private readonly eventLog: EventLogService,
    @Inject(DISPLAY_CONFIG) private readonly display: DisplayConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional()
    @Inject(CONSENT)
    private readonly consent: ConsentText = PROVISIONAL_CONSENT,
  ) {}

  /**
   * @throws DuplicateDocumentError when the document already exists.
   * @throws DisplayValidationError when `displayName` does not fit the screen.
   */
  async create(input: CreateStudentInput): Promise<Student> {
    const displayName = input.displayName
      ? this.checkDisplayName(input.displayName)
      : generateDisplayName(input.name, this.display.nameMax);
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
          : generateDisplayName(input.name, this.display.nameMax),
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
    if (version !== this.consent.version) {
      throw new ConsentVersionStaleError(this.consent.version);
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
      data.displayName = generateDisplayName(patch.name, this.display.nameMax);
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
    if (
      student &&
      consented &&
      student.consentVersion !== this.consent.version
    ) {
      student = await this.recordConsent(id, this.consent.version);
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
   * Cleanup of the data tied to an erased student (templates, enrollments).
   * Runs before the deactivation listeners; the return value counts the
   * templates deleted. Must be idempotent: erasing again retries it.
   */
  onErased(listener: ErasureListener): void {
    this.erasureListeners.push(listener);
  }

  /** Notified once everything is cleaned (e.g. to resync the reader). */
  afterErased(listener: (student: Student) => void): void {
    this.afterErasureListeners.push(listener);
  }

  /**
   * Erases the personal data of a student (Ley 1581, right to deletion): the
   * row stays, anonymised and inactive, so the sessions and reports keep
   * adding up. Idempotent and retriable: the personal data goes first, so if
   * a later cleanup fails it no longer exists and repeating the call finishes
   * the work.
   * @param confirmDocument must equal the current document; null skips the
   *   check (re-applying erasures after restoring a backup).
   * @returns null when the student does not exist.
   * @throws ErasureConfirmationError when the confirmation does not match.
   */
  async erase(
    id: string,
    confirmDocument: string | null,
  ): Promise<ErasureResult | null> {
    const before = await this.repository.findById(id);
    if (!before) return null;
    if (confirmDocument !== null && confirmDocument !== before.document) {
      throw new ErasureConfirmationError();
    }
    const firstTime = !before.anonymizedAt;
    const student = firstTime
      ? await this.repository.anonymize(
          id,
          {
            name: ANONYMIZED_NAME,
            document: `ANON-${id.replaceAll('-', '').slice(0, 8)}`,
            displayName: ANONYMIZED_DISPLAY_NAME,
          },
          this.clock.now(),
        )
      : before;
    if (!student) return null;
    let templatesDeleted = 0;
    for (const listener of this.erasureListeners) {
      try {
        templatesDeleted += (await listener(student)) ?? 0;
      } catch (error) {
        this.logger.error({
          event: 'erasure_cleanup_failed',
          studentId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    await this.runDeactivationListeners(student);
    // Identifiers and counts only: no personal data goes to the audit trail.
    if (firstTime || templatesDeleted > 0) {
      await this.eventLog.record('student.erased', {
        studentId: id,
        // Not named "templates": the audit filter drops keys that look biometric.
        fingerprintsDeleted: templatesDeleted,
      });
    }
    await this.eventLog.redactStudent(id);
    for (const listener of this.afterErasureListeners) listener(student);
    return { studentId: id, templatesDeleted };
  }

  /**
   * Logical deactivation, idempotent. A failing listener does not undo it
   * (the student stays blocked); repeating the call retries the cleanup.
   */
  async deactivate(id: string): Promise<Student | null> {
    const student = await this.repository.deactivate(id);
    if (!student) return null;
    await this.eventLog.record('student.deactivated', { studentId: id });
    await this.runDeactivationListeners(student);
    return student;
  }

  private async runDeactivationListeners(student: Student): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(student);
      } catch (error) {
        this.logger.error({
          event: 'deactivation_cleanup_failed',
          studentId: student.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private currentConsent(): ConsentRecord {
    const actor = currentActor();
    return {
      version: this.consent.version,
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
    const checked = validateDisplayMessage(
      { title: value },
      { titleMax: this.display.nameMax, subtitleMax: 0, subtitleLines: 0 },
    );
    if (!checked.ok) {
      throw new DisplayValidationError(
        checked.errors.map((error) => ({
          ...error,
          message: error.message.replace('el título', 'el nombre en pantalla'),
        })),
      );
    }
    if (checked.message.title === '') {
      throw new DisplayValidationError([
        { field: 'title', limit: null, message: 'displayName cannot be empty' },
      ]);
    }
    return checked.message.title;
  }

  /**
   * Names generated before the TFT (16 characters, ASCII) or with another
   * DISPLAY_NAME_MAX still count as generated, so a rename refreshes them.
   */
  private isGenerated(student: Student): boolean {
    return [this.display.nameMax, DISPLAY_DEFAULTS.nameMax, 16].some((max) => {
      const generated = generateDisplayName(student.name, max);
      return (
        student.displayName === generated ||
        student.displayName === toAscii(generated)
      );
    });
  }
}
