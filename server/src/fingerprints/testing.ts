import { SystemEventsService } from '../common/events/system-events.service.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { DevicesService } from '../devices/devices.service.js';
import { InMemoryDeviceCommandsRepository } from '../devices/infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from '../devices/infrastructure/in-memory-devices.repository.js';
import type { OutboundSender } from '../devices/outbound-sender.service.js';
import type { Env } from '../config/env.schema.js';
import { buildStudentsService } from '../students/testing.js';
import type { Clock } from '../common/time/clock.js';
import { Keyring } from './crypto/keyring.js';
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
  const { service: students, eventLog } = buildStudentsService();
  const devices = new DevicesService(
    new InMemoryDevicesRepository(),
    new InMemoryDeviceCommandsRepository(),
  );
  const send = vi.fn().mockResolvedValue(sendResult);
  const sender = { send, sendCommand: send } as unknown as OutboundSender;
  const cipher = new TemplateCipher(Keyring.single(randomBytes(32)));
  const events = new SystemEventsService();
  const service = new EnrollmentService(
    students,
    devices,
    sender,
    cipher,
    enrollments,
    fingerprints,
    defaultFingerprintsConfig,
    clock,
    new EventLogService(eventLog),
    events,
  );
  return {
    service,
    events,
    students,
    eventLog,
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
