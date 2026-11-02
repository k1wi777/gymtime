import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DevicesService } from '../devices/devices.service.js';
import { EnrollmentService } from '../fingerprints/enrollment.service.js';
import { SyncService } from './sync.service.js';

/**
 * Connects the sync to the events of other modules through their extension
 * points (`onConnected`, `onCompleted`); neither module knows `sync`.
 * `requestSync` never rejects and the listeners do not wait for it: a sync takes
 * seconds and must not hold back `hello.ok` or the ack of `enroll.done`.
 */
@Injectable()
export class SyncTriggersRegistrar implements OnModuleInit {
  constructor(
    private readonly devices: DevicesService,
    private readonly enrollments: EnrollmentService,
    private readonly sync: SyncService,
  ) {}

  onModuleInit(): void {
    this.devices.onConnected((deviceId) => {
      void this.sync.requestSync('connected', deviceId);
    });
    this.enrollments.onCompleted(({ deviceId }) => {
      void this.sync.requestSync('enrollment', deviceId);
    });
  }
}
