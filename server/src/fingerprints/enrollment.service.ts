import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PROTOCOL_VERSION, type ServerMessage } from '@gymtime/shared';
import { DevicesService } from '../devices/devices.service.js';
import { OutboundSender } from '../devices/outbound-sender.service.js';
import type { Student } from '../students/domain/student.js';
import { StudentsService } from '../students/students.service.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { TemplateCipher } from './crypto/template-cipher.service.js';
import { isOpen, OPEN_STATUSES, type Enrollment } from './domain/enrollment.js';
import {
  ENROLLMENTS_REPOSITORY,
  type EnrollmentsRepository,
} from './domain/enrollments.repository.js';
import {
  FINGERPRINTS_REPOSITORY,
  type FingerprintsRepository,
} from './domain/fingerprints.repository.js';
import { EnrollmentError } from './enrollment.errors.js';
import {
  FINGERPRINTS_CONFIG,
  type FingerprintsConfig,
} from './fingerprints.config.js';
import { KeyedMutex } from '../common/concurrency/keyed-mutex.js';
import { validateTemplate } from './template-validator.js';

const IN_PROGRESS = ['in_progress'] as const;

export interface EnrollmentCompletedEvent {
  deviceId: string;
  studentId: string;
  enrollmentId: string;
}

export type CompletedListener = (
  event: EnrollmentCompletedEvent,
) => Promise<void> | void;

/**
 * Enrollment rules and state machine. Valid transitions only:
 * pending -> in_progress | failed | cancelled | expired
 * in_progress -> done | failed | cancelled | expired
 * Terminal states never change; every change is a compare-and-set.
 */
@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);
  // One reader has one work slot: starts and device events of a device are serialized.
  private readonly deviceLock = new KeyedMutex();
  private readonly completedListeners: CompletedListener[] = [];

  constructor(
    private readonly students: StudentsService,
    private readonly devices: DevicesService,
    private readonly sender: OutboundSender,
    private readonly cipher: TemplateCipher,
    @Inject(ENROLLMENTS_REPOSITORY)
    private readonly enrollments: EnrollmentsRepository,
    @Inject(FINGERPRINTS_REPOSITORY)
    private readonly fingerprints: FingerprintsRepository,
    @Inject(FINGERPRINTS_CONFIG) private readonly config: FingerprintsConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Extension point so other modules react to a stored fingerprint without
   * `fingerprints` depending on them.
   */
  onCompleted(listener: CompletedListener): void {
    this.completedListeners.push(listener);
  }

  /** Starts enrolling a student on `deviceId`, or on the only online device. */
  async start(studentId: string, deviceId?: string): Promise<Enrollment> {
    const student = await this.students.findById(studentId);
    if (!student) {
      throw new EnrollmentError('STUDENT_NOT_FOUND', 'Student not found');
    }
    if (!student.active) {
      throw new EnrollmentError('STUDENT_INACTIVE', 'Student is inactive');
    }
    const target = deviceId ?? (await this.devices.getOnlineDeviceId());
    if (!target) {
      throw new EnrollmentError(
        'DEVICE_UNAVAILABLE',
        'No device available; connect one or pass deviceId',
      );
    }
    return this.deviceLock.run(target, () => this.startOn(student, target));
  }

  async cancel(id: string): Promise<Enrollment> {
    const enrollment = await this.require(id);
    const cancelled = await this.enrollments.transition(
      enrollment.id,
      OPEN_STATUSES,
      { status: 'cancelled' },
    );
    if (!cancelled) {
      throw new EnrollmentError(
        'ENROLLMENT_FINISHED',
        `Enrollment already ${enrollment.status}`,
      );
    }
    this.logger.log({ event: 'enrollment_cancelled', enrollmentId: id });
    void this.sendCancel(cancelled);
    return cancelled;
  }

  /** Current state; an overdue open enrollment is expired first. */
  async get(id: string): Promise<Enrollment> {
    const enrollment = await this.require(id);
    if (isOpen(enrollment.status) && this.isOverdue(enrollment)) {
      await this.expire(enrollment);
      return this.require(id);
    }
    return enrollment;
  }

  /** Expires every overdue open enrollment; returns how many changed. */
  async expireOverdue(): Promise<number> {
    const overdue = await this.enrollments.findOverdue(this.clock.now());
    let expired = 0;
    for (const enrollment of overdue) {
      if (await this.expire(enrollment)) expired += 1;
    }
    return expired;
  }

  async handleProgress(
    deviceId: string,
    enrollmentId: string,
    step: string,
  ): Promise<void> {
    await this.deviceLock.run(deviceId, async () => {
      const enrollment = await this.findForEvent(deviceId, enrollmentId);
      if (!enrollment) return;
      await this.enrollments.transition(enrollment.id, IN_PROGRESS, {
        status: 'in_progress',
        step,
      });
    });
  }

  /** Idempotent: a repeated done finds the enrollment already finished. */
  async handleDone(
    deviceId: string,
    enrollmentId: string,
    template: string,
  ): Promise<void> {
    const completed = await this.deviceLock.run(deviceId, async () => {
      const enrollment = await this.findForEvent(deviceId, enrollmentId);
      if (!enrollment) return null;
      const checked = validateTemplate(template, this.config);
      if (!checked.ok) {
        await this.enrollments.transition(enrollment.id, IN_PROGRESS, {
          status: 'failed',
          failureReason: `${checked.code}: ${checked.reason}`,
        });
        this.logger.warn({
          event: 'enrollment_template_rejected',
          enrollmentId,
          code: checked.code,
        });
        return null;
      }
      const encrypted = this.cipher.encrypt(checked.bytes);
      const done = await this.enrollments.completeWithFingerprint(
        enrollment.id,
        { template: encrypted.data, iv: encrypted.iv },
      );
      if (done) {
        this.logger.log({
          event: 'enrollment_done',
          enrollmentId,
          studentId: done.studentId,
        });
        return { deviceId, studentId: done.studentId, enrollmentId };
      }
      return null;
    });
    // Outside the device lock and not awaited by the ack path of the event.
    if (completed) await this.notifyCompleted(completed);
  }

  private async notifyCompleted(event: EnrollmentCompletedEvent) {
    for (const listener of this.completedListeners) {
      try {
        await listener(event);
      } catch (error) {
        this.logger.error({
          event: 'completed_listener_failed',
          enrollmentId: event.enrollmentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async handleFailed(
    deviceId: string,
    enrollmentId: string,
    reason: string,
  ): Promise<void> {
    await this.deviceLock.run(deviceId, async () => {
      const enrollment = await this.findForEvent(deviceId, enrollmentId);
      if (!enrollment) return;
      await this.enrollments.transition(enrollment.id, OPEN_STATUSES, {
        status: 'failed',
        failureReason: reason,
      });
      this.logger.log({ event: 'enrollment_failed', enrollmentId, reason });
    });
  }

  /** Cleanup after a deactivation: no open enrollments and no fingerprint. */
  async onStudentDeactivated(student: Student): Promise<void> {
    const open = await this.enrollments.findOpenByStudent(student.id);
    for (const enrollment of open) {
      const cancelled = await this.enrollments.transition(
        enrollment.id,
        OPEN_STATUSES,
        { status: 'cancelled' },
      );
      if (cancelled) void this.sendCancel(cancelled);
    }
    await this.fingerprints.deleteByStudent(student.id);
    this.logger.log({ event: 'student_cleanup_done', studentId: student.id });
  }

  private async startOn(student: Student, deviceId: string) {
    await this.expireOverdue();
    const busy = await this.enrollments.findOpenByDevice(deviceId);
    if (busy.length > 0) {
      throw new EnrollmentError(
        'DEVICE_BUSY',
        'The device already has an open enrollment',
      );
    }
    const { enrollTimeoutSec, ackMarginSec, enrollSlot } = this.config;
    const expiresAt = new Date(
      this.clock.now().getTime() + (enrollTimeoutSec + ackMarginSec) * 1000,
    );
    const enrollment = await this.enrollments.create({
      studentId: student.id,
      deviceId,
      expiresAt,
    });
    const result = await this.sender.sendCommand(
      deviceId,
      this.message('enroll.start', {
        enrollmentId: enrollment.id,
        scratchSlot: enrollSlot,
        timeoutSec: enrollTimeoutSec,
      }),
    );
    if (result === 'failed') {
      await this.enrollments.transition(enrollment.id, ['pending'], {
        status: 'failed',
        failureReason: 'DEVICE_UNAVAILABLE',
      });
      void this.sendCancel(enrollment);
      throw new EnrollmentError(
        'DEVICE_UNAVAILABLE',
        'Device did not confirm enroll.start',
      );
    }
    // A queued order is delivered when the device reconnects; the enrollment
    // stays pending until the device reports enroll.progress.
    if (result === 'queued') return this.require(enrollment.id);
    // Null when it was cancelled or expired while waiting for the ack.
    const started = await this.enrollments.transition(
      enrollment.id,
      ['pending'],
      { status: 'in_progress' },
    );
    return started ?? this.require(enrollment.id);
  }

  private async expire(enrollment: Enrollment): Promise<boolean> {
    const expired = await this.enrollments.transition(
      enrollment.id,
      OPEN_STATUSES,
      { status: 'expired' },
    );
    if (!expired) return false;
    this.logger.warn({
      event: 'enrollment_expired',
      enrollmentId: enrollment.id,
    });
    // Returns the reader to normal mode even if it never answered.
    void this.sendCancel(expired);
    return true;
  }

  /** Best effort: never blocks or fails the caller. */
  private async sendCancel(enrollment: Enrollment): Promise<void> {
    try {
      await this.sender.sendCommand(
        enrollment.deviceId,
        this.message('enroll.cancel', { enrollmentId: enrollment.id }),
      );
    } catch (error) {
      this.logger.error({
        event: 'enroll_cancel_failed',
        enrollmentId: enrollment.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** The open enrollment an event refers to, or null (ignored, R15). */
  private async findForEvent(deviceId: string, enrollmentId: string) {
    const enrollment = await this.enrollments.findById(enrollmentId);
    if (
      !enrollment ||
      enrollment.deviceId !== deviceId ||
      enrollment.status !== 'in_progress'
    ) {
      this.logger.warn({
        event: 'enrollment_event_ignored',
        deviceId,
        enrollmentId,
        status: enrollment?.status ?? null,
      });
      return null;
    }
    return enrollment;
  }

  private async require(id: string): Promise<Enrollment> {
    const enrollment = await this.enrollments.findById(id);
    if (!enrollment) {
      throw new EnrollmentError('ENROLLMENT_NOT_FOUND', 'Enrollment not found');
    }
    return enrollment;
  }

  private isOverdue(enrollment: Enrollment): boolean {
    return enrollment.expiresAt.getTime() <= this.clock.now().getTime();
  }

  private message<T extends 'enroll.start' | 'enroll.cancel'>(
    type: T,
    payload: Extract<ServerMessage, { type: T }>['payload'],
  ): ServerMessage {
    return {
      v: PROTOCOL_VERSION,
      id: randomUUID(),
      type,
      ts: Math.floor(this.clock.now().getTime() / 1000),
      ref: null,
      payload,
    } as ServerMessage;
  }
}
