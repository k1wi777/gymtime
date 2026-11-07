import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { DevicesService } from '../devices/devices.service.js';
import { InMemoryDeviceCommandsRepository } from '../devices/infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from '../devices/infrastructure/in-memory-devices.repository.js';
import { Keyring } from '../fingerprints/crypto/keyring.js';
import { TemplateCipher } from '../fingerprints/crypto/template-cipher.service.js';
import { defaultFingerprintsConfig } from '../fingerprints/fingerprints.config.js';
import { FingerprintsService } from '../fingerprints/fingerprints.service.js';
import { InMemoryFingerprintsRepository } from '../fingerprints/infrastructure/in-memory-fingerprints.repository.js';
import { validTemplate } from '../fingerprints/testing.js';
import { buildSchedulesFixture } from '../schedules/testing.js';
import { InMemorySlotsRepository } from './infrastructure/in-memory-slots.repository.js';
import { SyncPlanner } from './sync-planner.service.js';
import { defaultSyncConfig, type SyncConfig } from './sync.config.js';

export const testSyncConfig: SyncConfig = {
  ...defaultSyncConfig,
  leadMinutes: 15,
};

/** Test fixture: schedules + fingerprints + sync planning on in-memory repositories. */
export function buildSyncFixture(config: SyncConfig = testSyncConfig) {
  const sf = buildSchedulesFixture();
  const cipher = new TemplateCipher(Keyring.single(randomBytes(32)));
  const fingerprintsRepo = new InMemoryFingerprintsRepository();
  const fingerprints = new FingerprintsService(
    sf.students,
    cipher,
    fingerprintsRepo,
    defaultFingerprintsConfig,
  );
  const devices = new DevicesService(
    new InMemoryDevicesRepository(),
    new InMemoryDeviceCommandsRepository(),
  );
  const slots = new InMemorySlotsRepository();
  const planner = new SyncPlanner(sf.instances, fingerprints, config);

  /** A student with a distinguishable template, optionally assigned to schedules. */
  const enroll = async (
    document: string,
    fill: number,
    scheduleIds: string[] = [],
  ) => {
    const student = await sf.newStudent(document);
    const encrypted = cipher.encrypt(
      Buffer.from(validTemplate(fill), 'base64'),
    );
    fingerprintsRepo.replaceActive(
      student.id,
      encrypted.data,
      encrypted.iv,
      encrypted.keyVersion,
    );
    for (const id of scheduleIds)
      await sf.schedules.assignStudent(id, student.id);
    return student;
  };

  return {
    ...sf,
    cipher,
    fingerprintsRepo,
    fingerprints,
    devices,
    slots,
    planner,
    enroll,
    config,
  };
}
