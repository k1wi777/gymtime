import { Inject, Injectable, Logger } from '@nestjs/common';
import { SLOT_MAX } from '@gymtime/shared';
import { StudentsService } from '../students/students.service.js';
import { TemplateCipher } from './crypto/template-cipher.service.js';
import {
  FINGERPRINTS_REPOSITORY,
  type FingerprintsRepository,
} from './domain/fingerprints.repository.js';
import {
  FINGERPRINTS_CONFIG,
  type FingerprintsConfig,
} from './fingerprints.config.js';

/** A decrypted template; it must stay in local variables and never be logged. */
export interface SyncableFingerprint {
  studentId: string;
  fingerprintId: string;
  template: Buffer;
}

export interface SyncableResult {
  /** In the order of the requested ids. */
  fingerprints: SyncableFingerprint[];
  /** Requested ids that cannot be loaded (inactive, no fingerprint, unreadable). */
  skippedStudentIds: string[];
}

/** Read access to fingerprints for other modules (the template sync). */
@Injectable()
export class FingerprintsService {
  private readonly logger = new Logger(FingerprintsService.name);

  constructor(
    private readonly students: StudentsService,
    private readonly cipher: TemplateCipher,
    @Inject(FINGERPRINTS_REPOSITORY)
    private readonly fingerprints: FingerprintsRepository,
    @Inject(FINGERPRINTS_CONFIG) private readonly config: FingerprintsConfig,
  ) {}

  /**
   * Slots 1..N the reader can hold for a sync: the enrollment work slot is
   * never assigned. With the work slot at SLOT_MAX this is SLOT_MAX - 1.
   */
  get syncSlotCapacity(): number {
    return Math.min(SLOT_MAX, this.config.enrollSlot - 1);
  }

  /** Which of these students have an active fingerprint (no template is read out). */
  async findStudentIdsWithFingerprint(
    studentIds: string[],
  ): Promise<Set<string>> {
    if (studentIds.length === 0) return new Set();
    const rows = await this.fingerprints.findActiveByStudents(studentIds);
    return new Set(rows.map((row) => row.studentId));
  }

  /** When each of these students enrolled the active fingerprint (no template is read out). */
  async findEnrolledSince(studentIds: string[]): Promise<Map<string, Date>> {
    if (studentIds.length === 0) return new Map();
    const rows = await this.fingerprints.findActiveByStudents(studentIds);
    return new Map(rows.map((row) => [row.studentId, row.createdAt]));
  }

  /**
   * Decrypts, in memory only, the active fingerprint of each active student.
   * Anything else is reported by student id, never by content.
   */
  async findSyncable(studentIds: string[]): Promise<SyncableResult> {
    if (studentIds.length === 0) {
      return { fingerprints: [], skippedStudentIds: [] };
    }
    const [students, rows] = await Promise.all([
      this.students.findByIds(studentIds),
      this.fingerprints.findActiveByStudents(studentIds),
    ]);
    const active = new Set(students.filter((s) => s.active).map((s) => s.id));
    const byStudent = new Map(rows.map((row) => [row.studentId, row]));
    const fingerprints: SyncableFingerprint[] = [];
    const skippedStudentIds: string[] = [];
    for (const studentId of studentIds) {
      const row = byStudent.get(studentId);
      if (!active.has(studentId) || !row) {
        skippedStudentIds.push(studentId);
        continue;
      }
      try {
        fingerprints.push({
          studentId,
          fingerprintId: row.id,
          template: this.cipher.decrypt({ data: row.template, iv: row.iv }),
        });
      } catch {
        this.logger.error({ event: 'template_unreadable', studentId });
        skippedStudentIds.push(studentId);
      }
    }
    return { fingerprints, skippedStudentIds };
  }
}
