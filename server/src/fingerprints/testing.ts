import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { DevicesService } from '../devices/devices.service.js';
import { InMemoryDevicesRepository } from '../devices/infrastructure/in-memory-devices.repository.js';
import type { OutboundSender } from '../devices/outbound-sender.service.js';
import type { Env } from '../config/env.schema.js';
import { InMemoryStudentsRepository } from '../students/infrastructure/in-memory-students.repository.js';
import { StudentsService } from '../students/students.service.js';
import type { Clock } from './clock.js';
import { TemplateCipher } from './crypto/template-cipher.service.js';
import { EnrollmentService } from './enrollment.service.js';
import { defaultFingerprintsConfig } from './fingerprints.config.js';
import { InMemoryEnrollmentsRepository } from './infrastructure/in-memory-enrollments.repository.js';
import { InMemoryFingerprintsRepository } from './infrastructure/in-memory-fingerprints.repository.js';

/** Test fixture: the fingerprints module wired on in-memory repositories. */
export function buildEnrollmentFixture(
  sendResult: 'acked' | 'failed' = 'acked',
) {
  let current = new Date('2026-01-01T00:00:00Z');
  const clock: Clock = { now: () => new Date(current) };
  const fingerprints = new InMemoryFingerprintsRepository();
  const enrollments = new InMemoryEnrollmentsRepository(fingerprints);
  const students = new StudentsService(new InMemoryStudentsRepository());
  const devices = new DevicesService(new InMemoryDevicesRepository());
  const send = vi.fn().mockResolvedValue(sendResult);
  const sender = { send } as unknown as OutboundSender;
  const cipher = new TemplateCipher({
    get: () => randomBytes(32).toString('base64'),
  } as unknown as ConfigService<Env, true>);
  const service = new EnrollmentService(
    students,
    devices,
    sender,
    cipher,
    enrollments,
    fingerprints,
    defaultFingerprintsConfig,
    clock,
  );
  return {
    service,
    students,
    devices,
    send,
    cipher,
    fingerprints,
    enrollments,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
    setSendResult: (result: 'acked' | 'failed') =>
      send.mockResolvedValue(result),
    newStudent: (document = '100') =>
      students.create({
        document,
        name: 'Ana',
        program: null,
        consented: true,
      }),
  };
}

export const validTemplate = (fill = 7) =>
  Buffer.alloc(defaultFingerprintsConfig.expectedTemplateBytes, fill).toString(
    'base64',
  );
