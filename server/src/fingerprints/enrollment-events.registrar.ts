import { Injectable, type OnModuleInit } from '@nestjs/common';
import { MessageProcessor } from '../devices/message-processor.service.js';
import { StudentsService } from '../students/students.service.js';
import { EnrollmentService } from './enrollment.service.js';

/**
 * Wires this module to the others through their public extension points:
 * the processor's handler registry (enroll.* events, R21) and the students'
 * deactivation listeners. Neither `devices` nor `students` know this module.
 */
@Injectable()
export class EnrollmentEventsRegistrar implements OnModuleInit {
  constructor(
    private readonly processor: MessageProcessor,
    private readonly students: StudentsService,
    private readonly enrollments: EnrollmentService,
  ) {}

  onModuleInit(): void {
    this.processor.registerHandler('enroll.progress', (deviceId, message) => {
      if (message.type !== 'enroll.progress') return;
      const { enrollmentId, step } = message.payload;
      return this.enrollments.handleProgress(deviceId, enrollmentId, step);
    });
    this.processor.registerHandler('enroll.done', (deviceId, message) => {
      if (message.type !== 'enroll.done') return;
      const { enrollmentId, template } = message.payload;
      return this.enrollments.handleDone(deviceId, enrollmentId, template);
    });
    this.processor.registerHandler('enroll.failed', (deviceId, message) => {
      if (message.type !== 'enroll.failed') return;
      const { enrollmentId, reason } = message.payload;
      return this.enrollments.handleFailed(deviceId, enrollmentId, reason);
    });
    this.students.onDeactivated((student) =>
      this.enrollments.onStudentDeactivated(student),
    );
  }
}
